import { trace } from "@opentelemetry/api";
import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { SessionStreamError, SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import type { SpacePortsChangedPayload } from "@neta-art/cohub-protocol/ports";
import { injectTrace } from "@cohub/tracing/propagator";
import { env } from "./env.js";
import {
  getAgentInstanceDeadLetterQueueKey,
  getAgentInstanceInputQueueKey,
  getAgentInstanceProcessingQueueKey,
} from "./ownership.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

export { redis };

const LIST_KEY_IN = getAgentInstanceInputQueueKey(env.AGENT_INSTANCE_ID);
const PROCESSING_KEY = getAgentInstanceProcessingQueueKey(env.AGENT_INSTANCE_ID);
const RECOVERING_KEY = `${PROCESSING_KEY}:recovering`;
const DEAD_LETTER_KEY = getAgentInstanceDeadLetterQueueKey(env.AGENT_INSTANCE_ID);

const STREAM_MAXLEN = 2000;
const STREAM_APPROX = "~";
const AGENT_SESSION_UPDATES_STREAM = "stream:agent:session_updates";
const SPACE_EVENTS_STREAM = "stream:space:events";
const DEAD_LETTER_MAX_ITEMS = 200;

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
  executionAuth: z
    .object({
      token: z.string().min(1),
      expiresAt: z.number(),
    })
    .nullable()
    .optional(),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
}).passthrough();

const AbortInputSchema = z.object({
  id: z.string().optional(),
  action: z.literal("abort"),
  spaceId: z.string().uuid(),
  sessionId: z.string().uuid().nullable().optional(),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
}).passthrough();

export const InputSchema = z.union([PromptInputSchema, AbortInputSchema]);
export type AgentInput = z.infer<typeof InputSchema>;

const sendOutputSchema = z.union([
  z.object({
    type: z.literal("stream_update"),
    spaceId: z.string().uuid(),
    sessionId: z.string().uuid(),
    turnId: z.string().uuid().nullable().optional(),
    seq: z.number().int().positive(),
    baseSeq: z.number().int().min(0),
    content: z.array(z.unknown()),
    snapshotContent: z.array(z.unknown()).optional(),
    messageId: z.string().nullable().optional(),
    messageOrdinal: z.number().int().min(0).nullable().optional(),
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

  const activeSpan = trace.getActiveSpan();
  activeSpan?.addEvent("agent.output.publish", {
    "cohub.space_id": parsed.data.spaceId,
    "cohub.session_id": parsed.data.sessionId ?? "",
    "agent.output.type": parsed.data.type,
    ...(parsed.data.type === "stream_update" ? { "agent.output.delta_block_count": parsed.data.content.length } : {}),
  });

  try {
    const sessionId = parsed.data.sessionId ?? "";
    // Inject trace context so downstream (API → Gateway) can continue the same trace
    const traceCarrier = injectTrace();
    const payload = JSON.stringify({ ...parsed.data, ...traceCarrier });
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
      throw err;
    });
  } catch (error) {
    if (error instanceof Error) activeSpan?.recordException(error);
    throw error;
  }
}

export async function sendSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    const traceCarrier = injectTrace();
    await redis.xadd(
      SPACE_EVENTS_STREAM,
      "MAXLEN",
      STREAM_APPROX,
      STREAM_MAXLEN,
      "*",
      "spaceId",
      spaceId,
      "type",
      "space.fs.changed",
      "payload",
      JSON.stringify({ type: "space.fs.changed", spaceId, payload, trace: traceCarrier }),
    );
  } catch (err) {
    console.error("[Redis] Failed to send space fs changed event:", err);
  }
}

export async function sendSpacePortsChanged(spaceId: string, payload: SpacePortsChangedPayload) {
  try {
    const traceCarrier = injectTrace();
    await redis.xadd(
      SPACE_EVENTS_STREAM,
      "MAXLEN",
      STREAM_APPROX,
      STREAM_MAXLEN,
      "*",
      "spaceId",
      spaceId,
      "type",
      "space.ports.changed",
      "payload",
      JSON.stringify({ type: "space.ports.changed", spaceId, payload, trace: traceCarrier }),
    );
  } catch (err) {
    console.error("[Redis] Failed to send space ports changed event:", err);
  }
}

async function pushDeadLetterEntry(entry: Record<string, unknown>) {
  await redis
    .multi()
    .rpush(DEAD_LETTER_KEY, JSON.stringify(entry))
    .ltrim(DEAD_LETTER_KEY, -DEAD_LETTER_MAX_ITEMS, -1)
    .exec();
}

async function moveToDeadLetterQueue(rawMessage: string, reason: string, extra?: Record<string, unknown>) {
  try {
    await pushDeadLetterEntry({
      rawMessage,
      reason,
      failedAt: new Date().toISOString(),
      ...extra,
    });
  } catch (error) {
    console.error("[Redis] Failed to push message to dead letter queue:", error);
  }
}

export async function recoverProcessingQueueOnStartup() {
  try {
    const recoveringExists = await redis.exists(RECOVERING_KEY);

    if (!recoveringExists) {
      const processingExists = await redis.exists(PROCESSING_KEY);
      if (!processingExists) return;

      const renamed = await redis.renamenx(PROCESSING_KEY, RECOVERING_KEY);
      if (renamed !== 1) {
        console.warn(
          `[Redis] Failed to claim processing recovery queue for ${PROCESSING_KEY}; another recovery key may already exist`,
        );
      }
    }

    const pendingCount = await redis.llen(RECOVERING_KEY);
    if (pendingCount === 0) {
      await redis.del(RECOVERING_KEY);
      return;
    }

    console.warn(
      `[Redis] Recovering ${pendingCount} stale processing message(s) from ${RECOVERING_KEY} to ${DEAD_LETTER_KEY}`,
    );

    while (true) {
      const rawMessage = await redis.lindex(RECOVERING_KEY, 0);
      if (!rawMessage) break;

      try {
        await pushDeadLetterEntry({
          rawMessage,
          reason: "recovered_on_startup",
          failedAt: new Date().toISOString(),
          recoveredFrom: PROCESSING_KEY,
        });
        await redis.lpop(RECOVERING_KEY);
      } catch (error) {
        console.error("[Redis] Failed to recover one processing message on startup:", error);
        break;
      }
    }

    const remaining = await redis.llen(RECOVERING_KEY);
    if (remaining === 0) {
      await redis.del(RECOVERING_KEY);
      return;
    }

    console.warn(
      `[Redis] Startup recovery stopped with ${remaining} message(s) still in ${RECOVERING_KEY}; will retry on next startup`,
    );
  } catch (error) {
    console.error("[Redis] Failed to recover processing queue on startup:", error);
  }
}

export async function listenForInput(
  handler: (
    input: AgentInput,
    rawMessage: string,
    ack: () => Promise<void>,
    reject: (reason: string) => Promise<void>,
    rawParsed: Record<string, unknown>,
  ) => void | Promise<void>,
) {
  console.log(`[Redis] Listening for input on ${LIST_KEY_IN}...`);
  while (true) {
    let rawMessage: string | null = null;

    try {
      rawMessage = await subClient.brpoplpush(LIST_KEY_IN, PROCESSING_KEY, 0);
      if (!rawMessage) continue;

      const rawParsed = JSON.parse(rawMessage) as Record<string, unknown>;
      const parsed = InputSchema.parse(rawParsed);
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
        const maybePromise = handler(parsed, currentRawMessage, ack, reject, rawParsed);
        void Promise.resolve(maybePromise).catch((asyncErr) => {
          console.error("[Redis] Async error in handler:", asyncErr);
          return reject(asyncErr instanceof Error ? asyncErr.message : String(asyncErr)).catch((rejectErr) => {
            console.error("[Redis] Failed to reject message after async handler error:", rejectErr);
          });
        });
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
