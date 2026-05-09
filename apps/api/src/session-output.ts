import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageRecord, SessionTurnRecord } from "@neta-art/cohub-protocol/model";
import type { GatewaySessionOutput } from "@neta-art/cohub-protocol/gateway";
import type { RealtimeMessageRecord, RealtimeTurnRecord, SessionStreamError, SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import {
  dispatchOutboundMessage,
  dispatchRealtimeEventToUsers,
  getProviderMessageRefBySessionMessage,
  getReadableUserIdsForSpace,
  getBindingsBySessionId,
} from "./channels.js";
import { db } from "./db/index.js";
import { spaceChannels } from "./db/schema-v2.js";
import { redisCommandClient } from "./redis.js";
import { buildPatchOpsForContentDelta, getAppendPathForStreamEvent } from "./session-stream-patch-delta.js";

const STREAM_SNAPSHOT_TTL_SECONDS = 60 * 60;
const streamSnapshotKey = (spaceId: string, sessionId: string) =>
  `session:stream:snapshot:${spaceId}:${sessionId}`;
const streamSnapshotUserIndexKey = (userId: string) =>
  `session:stream:snapshots:user:${userId}`;

export type SessionStreamSnapshotMessage = {
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
};

export type SessionStreamSnapshot = {
  version: 2;
  spaceId: string;
  sessionId: string;
  turnId: string | null;
  anchorUserMessageId: string | null;
  seq: number;
  current: SessionStreamSnapshotMessage & { appendPath: string | null };
  intermediateMessages: SessionStreamSnapshotMessage[];
  targetUserIds: string[];
  updatedAt: number;
};

const pickRealtimeMessageMeta = (meta: Record<string, unknown> | null | undefined) => {
  if (!meta) return null;
  const keys = [
    "messageKind",
    "clientMessageId",
    "anchorUserMessageId",
    "userId",
    "contentDetail",
    "contentPlaceholder",
    "historySummary",
  ];
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (meta[key] !== undefined) picked[key] = meta[key];
  }
  return Object.keys(picked).length > 0 ? picked : null;
};

const toRealtimeMessageRecord = (message: MessageRecord): RealtimeMessageRecord => ({
  id: message.id,
  sessionId: message.sessionId,
  role: message.role,
  content: message.content,
  text: message.content.length > 0 ? null : message.text,
  sequence: message.sequence,
  provider: message.provider,
  model: message.model,
  stopReason: message.stopReason,
  errorMessage: message.errorMessage,
  usage: message.usage,
  meta: pickRealtimeMessageMeta(message.meta),
  createdAt: message.createdAt,
});

export const toRealtimeTurnRecord = (turn: SessionTurnRecord): RealtimeTurnRecord => ({
  id: turn.id,
  sessionId: turn.sessionId,
  sequence: turn.sequence,
  status: turn.status,
  intent: turn.intent,
  userUuid: turn.userUuid,
  authorProfile: turn.authorProfile,
  userText: turn.userText,
  assistantText: turn.assistantText,
  provider: turn.provider,
  model: turn.model,
  stopReason: turn.stopReason,
  errorMessage: turn.errorMessage,
  finalUsage: turn.finalUsage,
  totalUsage: turn.totalUsage,
  summary: turn.summary,
  intermediateIndex: turn.intermediateIndex,
  intermediateSummary: turn.intermediateSummary,
  startedAt: turn.startedAt,
  completedAt: turn.completedAt,
  createdAt: turn.createdAt,
  updatedAt: turn.updatedAt,
});

export const buildSessionOutputsForStreamEvent = async (
  event: SessionStreamEvent | SessionStreamError,
): Promise<GatewaySessionOutput[]> => {
  if (event.type === "stream_update") {
    const ops = buildPatchOpsForContentDelta({ event });
    return [{
      type: "session.turn.patch",
      spaceId: event.spaceId,
      sessionId: event.sessionId,
      turnId: event.turnId ?? null,
      messageId: event.messageId ?? null,
      messageOrdinal: event.messageOrdinal ?? null,
      anchorUserMessageId: event.anchorUserMessageId ?? null,
      seq: event.seq,
      baseSeq: event.baseSeq,
      ops,
      snapshotContent: event.snapshotContent,
      appendPath: getAppendPathForStreamEvent(event),
    } as Extract<GatewaySessionOutput, { type: "session.turn.patch" }> & {
      snapshotContent?: ContentBlock[];
      appendPath?: string | null;
    }];
  }

  return [{
    type: "session.turn.error",
    spaceId: event.spaceId,
    sessionId: event.sessionId ?? "unknown",
    anchorUserMessageId: null,
    error: event.error,
  }];
};

export const buildSessionOutputsForPersistedMessage = async (input: {
  spaceId: string;
  sessionId: string;
  message: MessageRecord;
}): Promise<GatewaySessionOutput[]> => {
  const outputs: GatewaySessionOutput[] = [{
    type: "session.message.persisted",
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    message: input.message,
  }];

  if (input.message.meta?.messageKind === "assistant_error" && input.message.stopReason !== "aborted") {
    outputs.push({
      type: "session.turn.error",
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      anchorUserMessageId: typeof input.message.meta?.anchorUserMessageId === "string"
        ? (input.message.meta.anchorUserMessageId as string)
        : null,
      error: input.message.errorMessage ?? "assistant error",
    });
  }

  return outputs;
};

const isSameSnapshotMessage = (
  a: Pick<SessionStreamSnapshotMessage, "messageId" | "messageOrdinal">,
  b: Pick<SessionStreamSnapshotMessage, "messageId" | "messageOrdinal">,
) => {
  if (a.messageId && b.messageId) return a.messageId === b.messageId;
  return a.messageOrdinal != null && b.messageOrdinal != null && a.messageOrdinal === b.messageOrdinal;
};

const parseExistingStreamSnapshot = (raw: string | null): SessionStreamSnapshot | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionStreamSnapshot> & {
      messageId?: string | null;
      messageOrdinal?: number | null;
      content?: unknown;
      appendPath?: string | null;
    };
    if (value.version !== 2) return null;
    if (!Array.isArray(value.current?.content)) return null;
    return value as SessionStreamSnapshot;
  } catch {
    return null;
  }
};

const cacheSessionStreamSnapshot = async (
  output: Extract<GatewaySessionOutput, { type: "session.turn.patch" }>,
  targetUserIds: string[],
) => {
  const snapshotContent = (output as { snapshotContent?: unknown }).snapshotContent;
  if (!Array.isArray(snapshotContent) || output.seq <= 0) return;

  const key = streamSnapshotKey(output.spaceId, output.sessionId);
  const existing = parseExistingStreamSnapshot(await redisCommandClient.get(key).catch(() => null));
  const incoming: SessionStreamSnapshotMessage & { appendPath: string | null } = {
    messageId: output.messageId,
    messageOrdinal: output.messageOrdinal ?? null,
    content: snapshotContent as ContentBlock[],
    appendPath: (output as { appendPath?: unknown }).appendPath as string | null ?? null,
  };
  const sameTurnSnapshot = existing &&
    existing.spaceId === output.spaceId &&
    existing.sessionId === output.sessionId &&
    existing.turnId === output.turnId
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
    spaceId: output.spaceId,
    sessionId: output.sessionId,
    turnId: output.turnId,
    anchorUserMessageId: output.anchorUserMessageId,
    seq: output.seq,
    current: incoming,
    intermediateMessages,
    targetUserIds,
    updatedAt: Date.now(),
  };
  const pipeline = redisCommandClient.pipeline();
  pipeline.set(key, JSON.stringify(snapshot), "EX", STREAM_SNAPSHOT_TTL_SECONDS);
  for (const userId of targetUserIds) {
    const indexKey = streamSnapshotUserIndexKey(userId);
    pipeline.sadd(indexKey, key);
    pipeline.expire(indexKey, STREAM_SNAPSHOT_TTL_SECONDS);
  }
  await pipeline.exec();
};

export const getSessionStreamSnapshot = async (input: { spaceId: string; sessionId: string }) => {
  const snapshot = parseExistingStreamSnapshot(
    await redisCommandClient.get(streamSnapshotKey(input.spaceId, input.sessionId)).catch(() => null),
  );
  if (!snapshot) return null;
  if (snapshot.spaceId !== input.spaceId || snapshot.sessionId !== input.sessionId) return null;
  const { targetUserIds: _targetUserIds, ...safeSnapshot } = snapshot;
  return safeSnapshot;
};

const clearSessionStreamSnapshot = async (spaceId: string, sessionId: string) => {
  await redisCommandClient.del(streamSnapshotKey(spaceId, sessionId)).catch(() => undefined);
};

const dispatchSessionOutputToRealtime = async (output: GatewaySessionOutput) => {
  const readableUserIds = await getReadableUserIdsForSpace(output.spaceId).catch(() => [] as string[]);
  if (output.type === "session.turn.patch") {
    await cacheSessionStreamSnapshot(output, readableUserIds).catch((error) => {
      console.warn("[SessionStreamSnapshot] failed to cache snapshot:", error);
    });
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "session",
      type: output.type,
      spaceId: output.spaceId,
      sessionId: output.sessionId,
      payload: {
        turnId: output.turnId,
        messageId: output.messageId,
        messageOrdinal: output.messageOrdinal ?? null,
        sourceMessageId: output.messageId,
        anchorUserMessageId: output.anchorUserMessageId,
        seq: output.seq,
        baseSeq: output.baseSeq,
        ops: output.ops,
        targetUserIds: readableUserIds,
      },
    });
    return;
  }

  if (output.type === "session.turn.error") {
    await clearSessionStreamSnapshot(output.spaceId, output.sessionId);
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "session",
      type: output.type,
      spaceId: output.spaceId,
      sessionId: output.sessionId,
      payload: {
        anchorUserMessageId: output.anchorUserMessageId,
        error: output.error,
        targetUserIds: readableUserIds,
      },
    });
    return;
  }

  await clearSessionStreamSnapshot(output.spaceId, output.sessionId);
  await dispatchRealtimeEventToUsers({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "session",
    type: output.type,
    spaceId: output.spaceId,
    sessionId: output.sessionId,
    payload: {
      message: toRealtimeMessageRecord(output.message),
      targetUserIds: readableUserIds,
    },
  });
};

const dispatchSessionOutputToChannels = async (output: GatewaySessionOutput) => {
  if (output.type !== "session.message.persisted") return;
  const message = output.message;
  if (message.role !== "assistant") return;

  const bindings = await getBindingsBySessionId(output.sessionId);
  if (bindings.length > 0) {
    for (const binding of bindings) {
      const turnAnchorMessageId = typeof message.meta?.anchorUserMessageId === "string"
        ? (message.meta.anchorUserMessageId as string)
        : message.id;
      const anchorRef = await getProviderMessageRefBySessionMessage({
        spaceChannelId: binding.spaceChannelId,
        sessionMessageId: turnAnchorMessageId,
        direction: "inbound",
      }).catch(() => null);

      await dispatchOutboundMessage({
        spaceChannelId: binding.spaceChannelId,
        spaceId: output.spaceId,
        spaceSessionId: output.sessionId,
        sessionMessageId: message.id,
        provider: binding.provider,
        externalChatId: binding.externalChatId,
        replyToExternalMessageId: anchorRef?.externalMessageId ?? undefined,
        content: message.content,
        meta: {
          sessionOutput: output,
          bindingKey: binding.bindingKey,
          sessionMessageRole: message.role,
          turnAnchorMessageId,
        },
      }).catch(console.error);
    }
    return;
  }

  const channels = await db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, output.spaceId));
  for (const channel of channels as Array<{ id: string }>) {
    await dispatchOutboundMessage({
      spaceChannelId: channel.id,
      spaceId: output.spaceId,
      spaceSessionId: output.sessionId,
      sessionMessageId: message.id,
      content: message.content,
      meta: {
        sessionOutput: output,
        sessionMessageRole: message.role,
      },
    }).catch(console.error);
  }
};

export const dispatchSessionOutput = async (output: GatewaySessionOutput) => {
  await dispatchSessionOutputToRealtime(output);
  await dispatchSessionOutputToChannels(output);
};

export const dispatchTurnUpdated = async (input: { spaceId: string; sessionId: string; turn: SessionTurnRecord }) => {
  const readableUserIds = await getReadableUserIdsForSpace(input.spaceId).catch(() => [] as string[]);
  await dispatchRealtimeEventToUsers({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "session",
    type: "session.turn.updated",
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    payload: {
      turn: toRealtimeTurnRecord(input.turn),
      targetUserIds: readableUserIds,
    },
  } as never);
};

export const dispatchTurnFinalized = async (input: { spaceId: string; sessionId: string; turn: SessionTurnRecord }) => {
  await clearSessionStreamSnapshot(input.spaceId, input.sessionId);
  const readableUserIds = await getReadableUserIdsForSpace(input.spaceId).catch(() => [] as string[]);
  await dispatchRealtimeEventToUsers({
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "session",
    type: "session.turn.finalized",
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    payload: {
      turn: toRealtimeTurnRecord(input.turn),
      targetUserIds: readableUserIds,
    },
  } as never);
};

export const dispatchSessionOutputs = async (outputs: GatewaySessionOutput[]) => {
  for (const output of outputs) {
    await dispatchSessionOutput(output);
  }
};
