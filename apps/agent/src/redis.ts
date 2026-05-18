import { randomUUID } from "node:crypto";
import { context, trace, type Span } from "@opentelemetry/api";
import { Redis } from "ioredis";
import { z } from "zod";
import type { ContentBlock } from "@cohub/protocol/core";
import type { RealtimeEnvelope, SessionStreamError, SessionStreamEvent } from "@cohub/protocol/realtime";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import type { SpacePortsChangedPayload } from "@cohub/protocol/ports";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { env } from "./env.js";
import { buildPatchOpsForContentDelta, getAppendPathForStreamEvent } from "./stream/patch-delta.js";

const redis = new Redis(env.REDIS_URL);

export { redis };

const AGENT_REALTIME_PATCH_CHANNEL = "pubsub:realtime:agent_patches";
const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";
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

type StreamTelemetryMetrics = {
  patchCount: number;
  publishErrorCount: number;
  bytesTotal: number;
  expiresAt: number;
};

const getStreamTelemetry = (span: Span) => {
  pruneExpiredStreamTelemetry();
  const key = span.spanContext().spanId;
  let metrics = streamTelemetryBySpanId.get(key);
  if (!metrics) {
    metrics = { patchCount: 0, publishErrorCount: 0, bytesTotal: 0, expiresAt: Date.now() + STREAM_TELEMETRY_TTL_MS };
    streamTelemetryBySpanId.set(key, metrics);
  } else {
    metrics.expiresAt = Date.now() + STREAM_TELEMETRY_TTL_MS;
  }
  return { key, metrics };
};

const clearStreamTelemetry = (span: Span) => {
  streamTelemetryBySpanId.delete(span.spanContext().spanId);
};

const pruneExpiredStreamTelemetry = () => {
  const now = Date.now();
  if (now - lastStreamTelemetryPruneAt < STREAM_TELEMETRY_PRUNE_INTERVAL_MS) return;
  lastStreamTelemetryPruneAt = now;
  for (const [key, metrics] of streamTelemetryBySpanId) {
    if (metrics.expiresAt <= now) streamTelemetryBySpanId.delete(key);
  }
};

const recordStreamPublishSuccess = (span: Span, event: SessionStreamEvent | SessionStreamError, envelopeBytes = 0) => {
  const { metrics } = getStreamTelemetry(span);
  if (event.type === "stream_update") {
    metrics.patchCount += 1;
    metrics.bytesTotal += envelopeBytes;
    span.setAttribute("agent.output.patch_count", metrics.patchCount);
    span.setAttribute("agent.output.bytes_total", metrics.bytesTotal);
    span.setAttribute("agent.output.last_seq", event.seq);
    if (metrics.patchCount === 1) {
      span.addEvent("agent.output.first_publish", {
        "cohub.space_id": event.spaceId,
        "cohub.session_id": event.sessionId,
        "agent.turn_id": event.turnId ?? "",
        "agent.output.seq": event.seq,
      });
    } else if (event.turnEnd) {
      span.addEvent("agent.output.final_publish", {
        "cohub.space_id": event.spaceId,
        "cohub.session_id": event.sessionId,
        "agent.turn_id": event.turnId ?? "",
        "agent.output.seq": event.seq,
        "agent.output.patch_count": metrics.patchCount,
        "agent.output.bytes_total": metrics.bytesTotal,
      });
      streamTelemetryBySpanId.delete(span.spanContext().spanId);
    } else if (metrics.patchCount % STREAM_PUBLISH_SAMPLE_EVERY === 0) {
      span.addEvent("agent.output.publish_sampled", {
        "agent.output.seq": event.seq,
        "agent.output.patch_count": metrics.patchCount,
      });
    }
  } else {
    span.addEvent("agent.output.error_publish", {
      "cohub.space_id": event.spaceId,
      "cohub.session_id": event.sessionId ?? "",
    });
    clearStreamTelemetry(span);
  }
};

const recordStreamPublishFailure = (span: Span, error: unknown) => {
  const { metrics } = getStreamTelemetry(span);
  metrics.publishErrorCount += 1;
  span.setAttribute("agent.output.publish_error_count", metrics.publishErrorCount);
  span.addEvent("agent.output.publish_failed");
  if (error instanceof Error) span.recordException(error);
};

const STREAM_TELEMETRY_TTL_MS = Math.max(60_000, Number(process.env.AGENT_STREAM_TELEMETRY_TTL_MS ?? 10 * 60_000));
const STREAM_TELEMETRY_PRUNE_INTERVAL_MS = Math.max(10_000, Number(process.env.AGENT_STREAM_TELEMETRY_PRUNE_INTERVAL_MS ?? 60_000));
const STREAM_PUBLISH_SAMPLE_EVERY = Math.max(1, Number(process.env.AGENT_STREAM_TELEMETRY_SAMPLE_EVERY ?? 20));
const streamTelemetryBySpanId = new Map<string, StreamTelemetryMetrics>();
let lastStreamTelemetryPruneAt = 0;

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
  const event = parsed.data as SessionStreamEvent | SessionStreamError;

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

    const payload = JSON.stringify({ ...envelope, ...traceCarrier });
    const span = trace.getActiveSpan();
    await redis.publish(AGENT_REALTIME_PATCH_CHANNEL, payload).catch((err) => {
      if (span) recordStreamPublishFailure(span, err);
      console.error("[Redis] Failed to publish realtime output:", err);
      throw err;
    });
    if (span) recordStreamPublishSuccess(span, event, Buffer.byteLength(payload));
  } catch (error) {
    if (error instanceof Error) activeSpan?.recordException(error);
    throw error;
  }
}

export async function sendSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  try {
    const traceCarrier = injectTrace();
    const message = JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.fs.changed",
      spaceId,
      sessionId: null,
      payload,
      trace: traceCarrier,
    });
    await context.with(trace.deleteSpan(context.active()), () => redis.publish(REALTIME_OUTBOUND_CHANNEL, message));
  } catch (err) {
    console.error("[Redis] Failed to send space fs changed event:", err);
  }
}

export async function sendSpacePortsChanged(spaceId: string, payload: SpacePortsChangedPayload) {
  try {
    const traceCarrier = injectTrace();
    const message = JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.ports.changed",
      spaceId,
      sessionId: null,
      payload,
      trace: traceCarrier,
    });
    await context.with(trace.deleteSpan(context.active()), () => redis.publish(REALTIME_OUTBOUND_CHANNEL, message));
  } catch (err) {
    console.error("[Redis] Failed to send space ports changed event:", err);
  }
}

export async function closeRedisConnections() {
  await redis.quit();
}
