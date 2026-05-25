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

type LocalSessionStreamSnapshotState = {
  snapshot: SessionStreamSnapshot;
  lastPersistedAt: number;
  persistTimer: ReturnType<typeof setTimeout> | null;
};

const SESSION_STREAM_SNAPSHOT_WRITE_INTERVAL_MS = Math.max(
  100,
  Number(process.env.AGENT_STREAM_SNAPSHOT_WRITE_INTERVAL_MS ?? 500),
);
const SESSION_STREAM_SNAPSHOT_LOCAL_TTL_MS = Math.max(
  60_000,
  Number(process.env.AGENT_STREAM_SNAPSHOT_LOCAL_TTL_MS ?? SESSION_STREAM_SNAPSHOT_TTL_SECONDS * 1000),
);
const SESSION_STREAM_SNAPSHOT_PRUNE_INTERVAL_MS = Math.max(
  10_000,
  Number(process.env.AGENT_STREAM_SNAPSHOT_PRUNE_INTERVAL_MS ?? 60_000),
);

const sessionStreamSnapshotStates = new Map<string, LocalSessionStreamSnapshotState>();
let lastSessionStreamSnapshotPruneAt = 0;

const clearSnapshotPersistTimer = (state: LocalSessionStreamSnapshotState) => {
  if (!state.persistTimer) return;
  clearTimeout(state.persistTimer);
  state.persistTimer = null;
};

const persistSessionStreamSnapshotNow = async (key: string) => {
  const state = sessionStreamSnapshotStates.get(key);
  if (!state) return;
  clearSnapshotPersistTimer(state);
  await redis.set(key, JSON.stringify(state.snapshot), "EX", SESSION_STREAM_SNAPSHOT_TTL_SECONDS);
  state.lastPersistedAt = Date.now();
};

const scheduleSessionStreamSnapshotPersist = async (key: string, force = false) => {
  const state = sessionStreamSnapshotStates.get(key);
  if (!state) return;

  if (force) {
    await persistSessionStreamSnapshotNow(key);
    return;
  }

  const elapsed = Date.now() - state.lastPersistedAt;
  if (elapsed >= SESSION_STREAM_SNAPSHOT_WRITE_INTERVAL_MS) {
    await persistSessionStreamSnapshotNow(key);
    return;
  }

  if (state.persistTimer) return;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    void persistSessionStreamSnapshotNow(key).catch((error) => {
      console.warn("[SessionStreamSnapshot] failed to persist snapshot:", error);
    });
  }, SESSION_STREAM_SNAPSHOT_WRITE_INTERVAL_MS - elapsed);
  state.persistTimer.unref?.();
};

const pruneLocalSessionStreamSnapshots = () => {
  const now = Date.now();
  if (now - lastSessionStreamSnapshotPruneAt < SESSION_STREAM_SNAPSHOT_PRUNE_INTERVAL_MS) return;
  lastSessionStreamSnapshotPruneAt = now;
  for (const [key, state] of sessionStreamSnapshotStates) {
    if (now - state.snapshot.updatedAt <= SESSION_STREAM_SNAPSHOT_LOCAL_TTL_MS) continue;
    clearSnapshotPersistTimer(state);
    sessionStreamSnapshotStates.delete(key);
  }
};

const getLocalSessionStreamSnapshot = async (key: string, event: SessionStreamEvent) => {
  const local = sessionStreamSnapshotStates.get(key);
  if (local) return local.snapshot;
  if (event.baseSeq === 0) return null;

  const existing = parseSessionStreamSnapshot(await redis.get(key).catch(() => null));
  if (!existing) return null;
  sessionStreamSnapshotStates.set(key, {
    snapshot: existing,
    lastPersistedAt: Date.now(),
    persistTimer: null,
  });
  return existing;
};

const cacheSessionStreamSnapshot = async (event: SessionStreamEvent) => {
  if (!Array.isArray(event.snapshotContent) || event.seq <= 0) return;

  pruneLocalSessionStreamSnapshots();

  const key = getSessionStreamSnapshotKey(event.spaceId, event.sessionId);
  const existing = await getLocalSessionStreamSnapshot(key, event);
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
  const messageChanged = Boolean(sameTurnSnapshot && !isSameSnapshotMessage(sameTurnSnapshot.current, incoming));
  const intermediateMessages = sameTurnSnapshot
    ? messageChanged
      ? [...sameTurnSnapshot.intermediateMessages, {
          messageId: sameTurnSnapshot.current.messageId,
          messageOrdinal: sameTurnSnapshot.current.messageOrdinal,
          content: sameTurnSnapshot.current.content,
        }]
      : sameTurnSnapshot.intermediateMessages
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

  const currentState = sessionStreamSnapshotStates.get(key);
  sessionStreamSnapshotStates.set(key, {
    snapshot,
    lastPersistedAt: currentState?.lastPersistedAt ?? 0,
    persistTimer: currentState?.persistTimer ?? null,
  });

  await scheduleSessionStreamSnapshotPersist(key, event.baseSeq === 0 || event.turnEnd === true || messageChanged);
};

const clearSessionStreamSnapshot = async (spaceId: string, sessionId: string) => {
  const key = getSessionStreamSnapshotKey(spaceId, sessionId);
  const state = sessionStreamSnapshotStates.get(key);
  if (state) clearSnapshotPersistTimer(state);
  sessionStreamSnapshotStates.delete(key);
  await redis.del(key).catch(() => undefined);
};

type StreamTelemetryMetrics = {
  patchCount: number;
  publishErrorCount: number;
  bytesTotal: number;
  expiresAt: number;
};

type StreamPublishDebugDetails = {
  opsCount: number;
  envelopeBytes: number;
  publishLatencyMs: number;
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

const recordStreamPublishSuccess = (
  span: Span,
  event: SessionStreamEvent | SessionStreamError,
  details: StreamPublishDebugDetails = { opsCount: 0, envelopeBytes: 0, publishLatencyMs: 0 },
) => {
  const { metrics } = getStreamTelemetry(span);
  if (event.type === "stream_update") {
    metrics.patchCount += 1;
    metrics.bytesTotal += details.envelopeBytes;
    span.setAttribute("agent.output.patch_count", metrics.patchCount);
    span.setAttribute("agent.output.bytes_total", metrics.bytesTotal);
    span.setAttribute("agent.output.last_seq", event.seq);
    span.setAttribute("agent.output.last_ops_count", details.opsCount);
    span.setAttribute("agent.output.last_bytes", details.envelopeBytes);
    span.setAttribute("agent.output.last_publish_latency_ms", details.publishLatencyMs);
    if (metrics.patchCount === 1) {
      span.addEvent("agent.output.first_publish", {
        "cohub.space_id": event.spaceId,
        "cohub.session_id": event.sessionId,
        "agent.turn_id": event.turnId ?? "",
        "agent.output.seq": event.seq,
        "agent.output.ops_count": details.opsCount,
        "agent.output.bytes": details.envelopeBytes,
        "agent.output.publish_latency_ms": details.publishLatencyMs,
      });
    } else if (event.turnEnd) {
      span.addEvent("agent.output.final_publish", {
        "cohub.space_id": event.spaceId,
        "cohub.session_id": event.sessionId,
        "agent.turn_id": event.turnId ?? "",
        "agent.output.seq": event.seq,
        "agent.output.patch_count": metrics.patchCount,
        "agent.output.bytes_total": metrics.bytesTotal,
        "agent.output.ops_count": details.opsCount,
        "agent.output.bytes": details.envelopeBytes,
        "agent.output.publish_latency_ms": details.publishLatencyMs,
      });
      streamTelemetryBySpanId.delete(span.spanContext().spanId);
    } else if (metrics.patchCount % STREAM_PUBLISH_SAMPLE_EVERY === 0) {
      span.addEvent("agent.output.publish_sampled", {
        "agent.output.seq": event.seq,
        "agent.output.patch_count": metrics.patchCount,
        "agent.output.ops_count": details.opsCount,
        "agent.output.bytes": details.envelopeBytes,
        "agent.output.publish_latency_ms": details.publishLatencyMs,
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
// Debug-only frontend patch publish telemetry for the current streaming stall investigation; remove after the investigation is complete.
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
    let opsCount = 0;

    if (event.type === "stream_update") {
      const streamEvent = event as SessionStreamEvent;
      const ops = buildPatchOpsForContentDelta(streamEvent);
      opsCount = ops.length;
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
    const publishStartedAt = performance.now();
    await redis.publish(AGENT_REALTIME_PATCH_CHANNEL, payload).catch((err) => {
      if (span) recordStreamPublishFailure(span, err);
      console.error("[Redis] Failed to publish realtime output:", err);
      throw err;
    });
    const publishLatencyMs = Math.round(performance.now() - publishStartedAt);
    if (span) {
      recordStreamPublishSuccess(span, event, {
        opsCount,
        envelopeBytes: Buffer.byteLength(payload),
        publishLatencyMs,
      });
    }
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
