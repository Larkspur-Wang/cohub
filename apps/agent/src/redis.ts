import { Redis } from "ioredis";
import { z } from "zod";
import { env } from "./env.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

const LIST_KEY_IN = `cohub:sessions:${env.SESSION_ID}:input_queue`;
const PROCESSING_KEY = `cohub:sessions:${env.SESSION_ID}:processing_queue`;
const DEAD_LETTER_KEY = `cohub:sessions:${env.SESSION_ID}:dead_letter_queue`;
const STREAM_KEY_OUT = `cohub:sessions:${env.SESSION_ID}:output_stream`;
const META_KEY = `cohub:sessions:${env.SESSION_ID}:meta`;

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
  userMessageId: z.string().uuid(),
  branchFromMessageId: z.string().uuid().nullable().optional(),
  message: z.object({
    text: z.string().min(1),
    images: z.array(ImageContentSchema).optional(),
  }),
});

const AbortInputSchema = z.object({
  action: z.literal("abort"),
});

export const InputSchema = z.union([PromptInputSchema, AbortInputSchema]);
export type AgentInput = z.infer<typeof InputSchema>;

/**
 * 设置 Session 状态
 */
export async function setSessionStatus(
  status: "starting" | "running" | "stopped" | "error",
) {
  await redis.hset(META_KEY, {
    status,
    updated_at: Date.now().toString(),
  });
}

/**
 * 发送增量输出或完整 Entry 到 Redis Stream
 */
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
      JSON.stringify({
        rawMessage,
        reason,
        failedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.error(
      "[Redis] Failed to push message to dead letter queue:",
      error,
    );
  }
}

/**
 * 阻塞监听用户输入队列，失败消息会进入 dead-letter queue
 */
export async function listenForInput(
  handler: (input: AgentInput) => Promise<void>,
) {
  console.log(`[Redis] Listening for input on ${LIST_KEY_IN}...`);
  while (true) {
    let rawMessage: string | null = null;

    try {
      rawMessage = await subClient.brpoplpush(LIST_KEY_IN, PROCESSING_KEY, 0);
      if (!rawMessage) {
        continue;
      }

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
