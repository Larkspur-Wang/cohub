import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock } from "@cohub/protocol";
import { env } from "./env.js";
import {
  getAgentInstanceDeadLetterQueueKey,
  getAgentInstanceInputQueueKey,
  getAgentInstanceProcessingQueueKey,
} from "./ownership.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

const LIST_KEY_IN = getAgentInstanceInputQueueKey(env.AGENT_INSTANCE_ID);
const PROCESSING_KEY = getAgentInstanceProcessingQueueKey(env.AGENT_INSTANCE_ID);
const DEAD_LETTER_KEY = getAgentInstanceDeadLetterQueueKey(env.AGENT_INSTANCE_ID);

const STREAM_MAXLEN = 10000;
const STREAM_APPROX = "~";

const PromptInputSchema = z.object({
  id: z.string().optional(),
  action: z.literal("prompt"),
  spaceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userMessageId: z.string().uuid().nullable().optional(),
  content: z.array(z.unknown()).min(1),
  meta: z
    .object({
      source: z.string().optional(),
      interactionId: z.string().optional(),
      actorUserId: z.string().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
});

const AbortInputSchema = z.object({
  id: z.string().optional(),
  action: z.literal("abort"),
  spaceId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
});

export const InputSchema = z.union([PromptInputSchema, AbortInputSchema]);
export type AgentInput = z.infer<typeof InputSchema>;

const getSpaceOutputStreamKey = (spaceId: string) => `spaces:${spaceId}:output_stream`;

export function extractContentText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text" && "text" in b)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export function extractContentImages(blocks: ContentBlock[]): Array<{ type: "image"; data: string; mimeType: string }> {
  const results: Array<{ type: "image"; data: string; mimeType: string }> = [];
  for (const b of blocks) {
    if (b.type !== "image") continue;
    const img = b as { type: "image"; source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string } };
    if (img.source.type !== "base64") continue;
    results.push({ type: "image", data: img.source.data, mimeType: img.source.media_type });
  }
  return results;
}

export async function sendOutput(data: { spaceId: string } & Record<string, unknown>) {
  const payload = JSON.stringify(data);
  await redis.xadd(getSpaceOutputStreamKey(data.spaceId), "MAXLEN", STREAM_APPROX, STREAM_MAXLEN, "*", "payload", payload).catch((err) => {
    console.error("[Redis] Failed to send output:", err);
  });
}

async function moveToDeadLetterQueue(rawMessage: string, reason: string) {
  try {
    await redis.rpush(
      DEAD_LETTER_KEY,
      JSON.stringify({ rawMessage, reason, failedAt: new Date().toISOString() }),
    );
  } catch (error) {
    console.error("[Redis] Failed to push message to dead letter queue:", error);
  }
}

export async function listenForInput(
  handler: (
    input: AgentInput,
    rawMessage: string,
    ack: () => Promise<void>,
    reject: (reason: string) => Promise<void>,
  ) => void,
) {
  console.log(`[Redis] Listening for input on ${LIST_KEY_IN}...`);
  while (true) {
    let rawMessage: string | null = null;

    try {
      rawMessage = await subClient.brpoplpush(LIST_KEY_IN, PROCESSING_KEY, 0);
      if (!rawMessage) continue;

      const parsed = InputSchema.parse(JSON.parse(rawMessage));
      const currentRawMessage = rawMessage;
      let handled = false;

      const ack = async () => {
        if (handled) return;
        handled = true;
        await redis.lrem(PROCESSING_KEY, 1, currentRawMessage).catch((e) => {
          console.error("[Redis] Failed to ack message:", e);
        });
      };

      const reject = async (reason: string) => {
        if (handled) return;
        handled = true;
        try {
          await moveToDeadLetterQueue(currentRawMessage, reason);
          await redis.lrem(PROCESSING_KEY, 1, currentRawMessage);
        } catch (e) {
          console.error("[Redis] Failed to reject message:", e);
        }
      };

      try {
        handler(parsed, currentRawMessage, ack, reject);
      } catch (syncErr) {
        console.error("[Redis] Sync error in handler:", syncErr);
        await reject(syncErr instanceof Error ? syncErr.message : String(syncErr));
      }
    } catch (err) {
      console.error("[Redis] Error processing input:", err);

      if (rawMessage) {
        const reason = err instanceof Error ? err.message : String(err);
        await moveToDeadLetterQueue(rawMessage, reason);
        await redis.lrem(PROCESSING_KEY, 1, rawMessage).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function closeRedisConnections() {
  await Promise.allSettled([subClient.quit(), redis.quit()]);
}
