import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageRecord } from "@neta-art/cohub-protocol/model";
import type { GatewaySessionOutput, GatewaySessionPatchOperation } from "@neta-art/cohub-protocol/gateway";
import type { RealtimeMessageRecord, SessionStreamError, SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import { dispatchOutboundMessage, dispatchRealtimeEventToUsers, getReadableUserIdsForSpace, getBindingsBySessionId } from "./channels.js";
import { db } from "./db/index.js";
import { spaceChannels } from "./db/schema-v2.js";

const pickRealtimeMessageMeta = (meta: Record<string, unknown> | null | undefined) => {
  if (!meta) return null;
  const keys = [
    "messageKind",
    "clientMessageId",
    "anchorUserMessageId",
    "authorUuid",
    "authorName",
    "authorAvatar",
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

const getStreamIndex = (block: ContentBlock, fallback: number) => {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const blockPatchPath = (block: ContentBlock, fallback: number) =>
  `/message/content/blocks/${getStreamIndex(block, fallback)}`;

type AppendPatchCursor = { p: string; lastSeenAt: number };

const PATCH_CURSOR_MAX_AGE_MS = 10 * 60 * 1000;
const appendPatchCursors = new Map<string, AppendPatchCursor>();

const patchCursorKey = (event: SessionStreamEvent) =>
  `${event.sessionId}:${event.turnId ?? event.sourceMessageId ?? event.anchorUserMessageId ?? "unknown"}`;

const pruneExpiredPatchCursors = (now: number) => {
  for (const [key, cursor] of appendPatchCursors) {
    if (now - cursor.lastSeenAt > PATCH_CURSOR_MAX_AGE_MS) {
      appendPatchCursors.delete(key);
    }
  }
};

const compactAppendPatchOps = (
  event: SessionStreamEvent,
  ops: GatewaySessionPatchOperation[],
): GatewaySessionPatchOperation[] => {
  const now = Date.now();
  pruneExpiredPatchCursors(now);
  const key = patchCursorKey(event);
  let cursor = event.baseSeq === 0 ? null : appendPatchCursors.get(key) ?? null;
  const compacted: GatewaySessionPatchOperation[] = [];

  for (const op of ops) {
    if (op.o === "append" && typeof op.p === "string") {
      if (cursor?.p === op.p) {
        compacted.push({ v: op.v });
      } else {
        compacted.push(op);
      }
      cursor = { p: op.p, lastSeenAt: now };
      continue;
    }
    compacted.push(op);
  }

  if (cursor) {
    appendPatchCursors.set(key, cursor);
  } else {
    appendPatchCursors.delete(key);
  }

  return compacted;
};

const buildPatchOpsForContentDelta = (input: {
  event: SessionStreamEvent;
}): GatewaySessionPatchOperation[] => {
  const ops: GatewaySessionPatchOperation[] = [];
  if (input.event.baseSeq === 0) {
    ops.push(
      { o: "replace", p: "/message/status", v: "streaming" },
      { o: "replace", p: "/message/end_turn", v: false },
    );
    const metadata: Record<string, unknown> = {
      is_complete: false,
    };
    if (input.event.turnId) metadata.turnId = input.event.turnId;
    if (input.event.anchorUserMessageId) metadata.anchorUserMessageId = input.event.anchorUserMessageId;
    ops.push({ o: "merge", p: "/message/metadata", v: metadata });
  }

  input.event.content.forEach((block, index) => {
    const path = blockPatchPath(block, index);
    if (block.type === "text") {
      ops.push({ o: "append", p: `${path}/text`, v: block.text });
      return;
    }
    if (block.type === "thinking") {
      ops.push({ o: "append", p: `${path}/thinking`, v: block.thinking });
      if (block.signature) {
        ops.push({ o: "replace", p: `${path}/signature`, v: block.signature });
      }
      return;
    }
    ops.push({ o: "replace", p: path, v: block });
  });

  return compactAppendPatchOps(input.event, ops);
};

export const buildSessionOutputsForStreamEvent = async (
  event: SessionStreamEvent | SessionStreamError,
): Promise<GatewaySessionOutput[]> => {
  if (event.type === "stream_update") {
    return [{
      type: "session.turn.patch",
      spaceId: event.spaceId,
      sessionId: event.sessionId,
      turnId: event.turnId ?? null,
      messageId: event.sourceMessageId ? `assistant:${event.sourceMessageId}` : null,
      anchorUserMessageId: event.anchorUserMessageId ?? null,
      seq: event.seq,
      baseSeq: event.baseSeq,
      ops: buildPatchOpsForContentDelta({ event }),
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

  if (input.message.meta?.messageKind === "assistant_error") {
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

const dispatchSessionOutputToRealtime = async (output: GatewaySessionOutput) => {
  const readableUserIds = await getReadableUserIdsForSpace(output.spaceId).catch(() => [] as string[]);
  if (output.type === "session.turn.patch") {
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
      await dispatchOutboundMessage({
        spaceChannelId: binding.spaceChannelId,
        spaceId: output.spaceId,
        spaceSessionId: output.sessionId,
        sessionMessageId: message.id,
        provider: binding.provider,
        externalChatId: binding.externalChatId,
        content: message.content,
        meta: {
          sessionOutput: output,
          bindingKey: binding.bindingKey,
          sessionMessageRole: message.role,
          turnAnchorMessageId: typeof message.meta?.anchorUserMessageId === "string"
            ? (message.meta.anchorUserMessageId as string)
            : message.id,
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

export const dispatchSessionOutputs = async (outputs: GatewaySessionOutput[]) => {
  for (const output of outputs) {
    await dispatchSessionOutput(output);
  }
};
