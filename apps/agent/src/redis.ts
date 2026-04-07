import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock } from "@cohub/protocol";
import { env } from "./env.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

const runtimePrefix = `runtimes:${env.RUNTIME_ID}`;
const LIST_KEY_IN = `${runtimePrefix}:input_queue`;
const PROCESSING_KEY = `${runtimePrefix}:processing_queue`;
const DEAD_LETTER_KEY = `${runtimePrefix}:dead_letter_queue`;
const STREAM_KEY_OUT = `${runtimePrefix}:output_stream`;
const META_KEY = `${runtimePrefix}:meta`;

const PromptInputSchema = z.object({
  action: z.literal("prompt"),
  runtimeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userMessageId: z.string().uuid().nullable().optional(),
  content: z.array(z.unknown()).min(1),
  meta: z
    .object({
      source: z.string().optional(),
      intent: z.enum(["auto", "continue", "new_session", "fork"]).optional(),
    })
    .nullable()
    .optional(),
});

const AbortInputSchema = z.object({
  action: z.literal("abort"),
  runtimeId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
});

export const InputSchema = z.union([PromptInputSchema, AbortInputSchema]);
export type AgentInput = z.infer<typeof InputSchema>;

/**
 * Extract plain text from a list of ContentBlocks.
 */
export function extractContentText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text" && "text" in b)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * Extract image blocks from ContentBlock[] in the format expected by the SDK.
 */
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

export async function setRuntimeStatus(
  status: "starting" | "running" | "stopped" | "error",
) {
  await redis.hset(META_KEY, {
    runtime_id: env.RUNTIME_ID,
    status,
    updated_at: Date.now().toString(),
  });
}

const STREAM_MAXLEN = 10000;
const STREAM_APPROX = "~";

export async function sendOutput(data: unknown) {
  try {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    await redis.xadd(STREAM_KEY_OUT, "MAXLEN", STREAM_APPROX, STREAM_MAXLEN, "*", "payload", payload);
  } catch (err) {
    console.error("[Redis] Failed to send output:", err);
  }
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
        // Fire and forget - handler manages its own ack/reject
        handler(parsed, ack, reject);
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
