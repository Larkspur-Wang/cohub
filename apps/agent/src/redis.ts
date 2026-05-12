import { randomUUID } from "node:crypto";
import { trace } from "@opentelemetry/api";
import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { RealtimeEnvelope, SessionStreamError, SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import type { SpaceFsChangedPayload } from "@neta-art/cohub-protocol/fs";
import type { SpacePortsChangedPayload } from "@neta-art/cohub-protocol/ports";
import { injectTrace } from "@cohub/tracing/propagator";
import { env } from "./env.js";
import {
  getAgentInstanceDeadLetterQueueKey,
  getAgentInstanceInputQueueKey,
  getAgentInstanceProcessingQueueKey,
} from "./ownership.js";
import { buildPatchOpsForContentDelta, getAppendPathForStreamEvent } from "./stream/patch-delta.js";
import { logger } from "./logger.js";

const redis = new Redis(env.REDIS_URL);
const subClient = redis.duplicate();

export { redis };

const LIST_KEY_IN = getAgentInstanceInputQueueKey(env.AGENT_INSTANCE_ID);
const PROCESSING_KEY = getAgentInstanceProcessingQueueKey(env.AGENT_INSTANCE_ID);
const RECOVERING_KEY = `${PROCESSING_KEY}:recovering`;
const DEAD_LETTER_KEY = getAgentInstanceDeadLetterQueueKey(env.AGENT_INSTANCE_ID);

const AGENT_REALTIME_PATCH_CHANNEL = "pubsub:realtime:agent_patches";
const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";
const DEAD_LETTER_MAX_ITEMS = 200;
const SESSION_STREAM_SNAPSHOT_TTL_SECONDS = 60 * 60;
const getSessionStreamSnapshotKey = (spaceId: string, sessionId: string) =>
  `session:stream:snapshot:${spaceId}:${sessionId}`;

type SessionStreamSnapshotMessage = {
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
};

type SessionStreamSnapshot = {
  version: 2;
  spaceId: string;
  sessionId: string;
  turnId: string | null;
  anchorUserMessageId: string | null;
  seq: number;
  current: SessionStreamSnapshotMessage & { appendPath: string | null };
  intermediateMessages: SessionStreamSnapshotMessage[];
  updatedAt: number;
};

const isSameSnapshotMessage = (
  a: Pick<SessionStreamSnapshotMessage, "messageId" | "messageOrdinal">,
  b: Pick<SessionStreamSnapshotMessage, "messageId" | "messageOrdinal">,
) => {
  if (a.messageId && b.messageId) return a.messageId === b.messageId;
  return a.messageOrdinal != null && b.messageOrdinal != null && a.messageOrdinal === b.messageOrdinal;
};

const parseSessionStreamSnapshot = (raw: string | null): SessionStreamSnapshot | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionStreamSnapshot>;
    if (value.version !== 2) return null;
    if (!value.spaceId || !value.sessionId) return null;
    if (!Array.isArray(value.current?.content)) return null;
    if (!Array.isArray(value.intermediateMessages)) return null;
    return value as SessionStreamSnapshot;
  } catch {
    return null;
  }
};

const cacheSessionStreamSnapshot = async (event: SessionStreamEvent) => {
  if (!Array.isArray(event.snapshotContent) || event.seq <= 0) return;

  const key = getSessionStreamSnapshotKey(event.spaceId, event.sessionId);
  const existing = parseSessionStreamSnapshot(await redis.get(key).catch(() => null));
  const incoming: SessionStreamSnapshot["current"] = {
    messageId: event.messageId ?? null,
    messageOrdinal: event.messageOrdinal ?? null,
    content: event.snapshotContent,
    appendPath: getAppendPathForStreamEvent(event),
  };
  const sameTurnSnapshot = existing &&
    existing.spaceId === event.spaceId &&
    existing.sessionId === event.sessionId &&
    existing.turnId === (event.turnId ?? null)
    ? existing
    : null;
  const intermediateMessages = sameTurnSnapshot
    ? isSameSnapshotMessage(sameTurnSnapshot.current, incoming)
      ? sameTurnSnapshot.intermediateMessages
      : [...sameTurnSnapshot.intermediateMessages, {
          messageId: sameTurnSnapshot.current.messageId,
          messageOrdinal: sameTurnSnapshot.current.messageOrdinal,
          content: sameTurnSnapshot.current.content,
        }]
    : [];

  const snapshot: SessionStreamSnapshot = {
    version: 2,
    spaceId: event.spaceId,
    sessionId: event.sessionId,
    turnId: event.turnId ?? null,
    anchorUserMessageId: event.anchorUserMessageId ?? event.sourceMessageId ?? null,
    seq: event.seq,
    current: incoming,
    intermediateMessages,
    updatedAt: Date.now(),
  };

  await redis.set(key, JSON.stringify(snapshot), "EX", SESSION_STREAM_SNAPSHOT_TTL_SECONDS);
};

const clearSessionStreamSnapshot = async (spaceId: string, sessionId: string) => {
  await redis.del(getSessionStreamSnapshotKey(spaceId, sessionId)).catch(() => undefined);
};

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
      clientMessageId: z.string().optional(),
      userId: z.string().optional(),
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
  turnId: z.string().uuid().nullable().optional(),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
}).passthrough();

const ForkSessionInputSchema = z.object({
  id: z.string().optional(),
  action: z.literal("fork_session"),
  spaceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  parentSessionId: z.string().uuid(),
  anchorTurnId: z.string().uuid(),
  anchorSequence: z.number().int().positive(),
  anchorEntryId: z.string().min(1),
  timestamp: z.string().optional(),
  expectedOwnerId: z.string().min(1),
  expectedEpoch: z.coerce.number().int().positive(),
}).passthrough();

export const InputSchema = z.union([PromptInputSchema, AbortInputSchema, ForkSessionInputSchema]);
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
  const event = parsed.data;
  const outputAttributes: Record<string, string | number> = {
    "cohub.space_id": event.spaceId,
    "cohub.session_id": event.sessionId ?? "",
    "agent.output.type": event.type,
  };
  if (event.type === "stream_update") {
    outputAttributes["agent.output.delta_block_count"] = event.content.length;
    if (event.sourceMessageId) outputAttributes["agent.input_message_id"] = event.sourceMessageId;
    if (event.anchorUserMessageId ?? event.sourceMessageId) outputAttributes["agent.anchor_user_message_id"] = event.anchorUserMessageId ?? event.sourceMessageId ?? "";
    if (event.turnId) outputAttributes["agent.turn_id"] = event.turnId;
    if (event.messageId) outputAttributes["agent.output.message_id"] = event.messageId;
    if (event.messageOrdinal != null) outputAttributes["agent.output.message_ordinal"] = event.messageOrdinal;
    outputAttributes["agent.output.seq"] = event.seq;
    outputAttributes["agent.output.base_seq"] = event.baseSeq;
  }
  activeSpan?.addEvent("agent.output.publish", outputAttributes);

  try {
    const traceCarrier = injectTrace();
    let envelope: RealtimeEnvelope;

    if (event.type === "stream_update") {
      const streamEvent = event as SessionStreamEvent;
      const ops = buildPatchOpsForContentDelta(streamEvent);
      await cacheSessionStreamSnapshot(streamEvent).catch((error) => {
        console.warn("[SessionStreamSnapshot] failed to cache snapshot:", error);
      });
      envelope = {
        id: randomUUID(),
        timestamp: Date.now(),
        domain: "session",
        type: "session.turn.patch",
        spaceId: event.spaceId,
        sessionId: event.sessionId,
        payload: {
          turnId: event.turnId ?? null,
          messageId: event.messageId ?? null,
          messageOrdinal: event.messageOrdinal ?? null,
          sourceMessageId: event.sourceMessageId ?? null,
          anchorUserMessageId: event.anchorUserMessageId ?? event.sourceMessageId ?? null,
          seq: event.seq,
          baseSeq: event.baseSeq,
          ops,
        },
      };
    } else {
      if (event.sessionId) await clearSessionStreamSnapshot(event.spaceId, event.sessionId);
      envelope = {
        id: randomUUID(),
        timestamp: Date.now(),
        domain: "session",
        type: "session.turn.error",
        spaceId: event.spaceId,
        sessionId: event.sessionId ?? "unknown",
        payload: {
          turnId: null,
          anchorUserMessageId: null,
          error: event.error,
        },
      };
    }

    await redis.publish(AGENT_REALTIME_PATCH_CHANNEL, JSON.stringify({ ...envelope, ...traceCarrier })).catch((err) => {
      console.error("[Redis] Failed to publish realtime output:", err);
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
    await redis.publish(REALTIME_OUTBOUND_CHANNEL, JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.fs.changed",
      spaceId,
      sessionId: null,
      payload,
      trace: traceCarrier,
    }));
  } catch (err) {
    console.error("[Redis] Failed to send space fs changed event:", err);
  }
}

export async function sendSpacePortsChanged(spaceId: string, payload: SpacePortsChangedPayload) {
  try {
    const traceCarrier = injectTrace();
    await redis.publish(REALTIME_OUTBOUND_CHANNEL, JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.ports.changed",
      spaceId,
      sessionId: null,
      payload,
      trace: traceCarrier,
    }));
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
  logger.info(`[Redis] Listening for input on ${LIST_KEY_IN}...`);
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
