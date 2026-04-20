import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock, SessionStreamError, SessionStreamEvent } from "@cohub/protocol";
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

const STREAM_MAXLEN = 2000;
const STREAM_APPROX = "~";
const AGENT_SESSION_UPDATES_STREAM = "stream:agent:session_updates";

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

const sendOutputSchema = z.union([
  z.object({
    type: z.literal("stream_update"),
    spaceId: z.string().uuid(),
    sessionId: z.string().uuid(),
    content: z.array(z.unknown()),
    sourceMessageId: z.string().uuid().nullable(),
    timestamp: z.number(),
    turnEnd: z.boolean().optional(),
    anchorUserMessageId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    type: z.literal("error"),
    spaceId: z.string().uuid(),
    sessionId: z.string().uuid().nullable(),
    error: z.string(),
  }),
]);

export async function sendOutput(data: SessionStreamEvent | SessionStreamError) {
  const parsed = sendOutputSchema.safeParse(data);
  if (!parsed.success) {
    console.error("[Redis] Invalid session output event:", parsed.error.issues);
    return;
  }

  if (parsed.data.type === "error" && !parsed.data.sessionId) {
    console.warn("[Redis] Skipping session error output without sessionId");
    return;
  }

  const sessionId = parsed.data.sessionId ?? "";
  const payload = JSON.stringify(parsed.data);
  await redis.xadd(
    AGENT_SESSION_UPDATES_STREAM,
    "MAXLEN",
    STREAM_APPROX,
    STREAM_MAXLEN,
    "*",
    "spaceId",
    parsed.data.spaceId,
    "sessionId",
    sessionId,
    "payload",
    payload,
  ).catch((err) => {
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
