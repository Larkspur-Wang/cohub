import { Redis } from "ioredis";
import { z } from "zod";
import { env } from "./env.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

const runtimePrefix = `runtimes:${env.RUNTIME_ID}`;
const LIST_KEY_IN = `${runtimePrefix}:input_queue`;
const PROCESSING_KEY = `${runtimePrefix}:processing_queue`;
const DEAD_LETTER_KEY = `${runtimePrefix}:dead_letter_queue`;
const STREAM_KEY_OUT = `${runtimePrefix}:output_stream`;
const META_KEY = `${runtimePrefix}:meta`;

type AgentImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

const ImageContentSchema: z.ZodType<AgentImageContent> = z.object({
  type: z.literal("image"),
  data: z.string().min(1),
  mimeType: z.string().min(1),
});

const PromptInputSchema = z.object({
  action: z.literal("prompt"),
  runtimeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userMessageId: z.string().uuid().nullable().optional(),
  message: z.object({
    text: z.string().min(1),
    images: z.array(ImageContentSchema).optional(),
  }),
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

export async function setRuntimeStatus(
  status: "starting" | "running" | "stopped" | "error",
) {
  await redis.hset(META_KEY, {
    runtime_id: env.RUNTIME_ID,
    status,
    updated_at: Date.now().toString(),
  });
}

export async function sendOutput(data: unknown) {
  try {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    await redis.xadd(STREAM_KEY_OUT, "*", "payload", payload);
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
  handler: (input: AgentInput) => Promise<void>,
) {
  console.log(`[Redis] Listening for input on ${LIST_KEY_IN}...`);
  while (true) {
    let rawMessage: string | null = null;

    try {
      rawMessage = await subClient.brpoplpush(LIST_KEY_IN, PROCESSING_KEY, 0);
      if (!rawMessage) continue;

      const parsed = InputSchema.parse(JSON.parse(rawMessage));
      await handler(parsed);
      await redis.lrem(PROCESSING_KEY, 1, rawMessage);
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
