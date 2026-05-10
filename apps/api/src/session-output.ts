import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MessageRecord, SessionTurnRecord } from "@neta-art/cohub-protocol/model";
import type { GatewaySessionOutput } from "@neta-art/cohub-protocol/gateway";
import type { RealtimeMessageRecord, RealtimeTurnRecord } from "@neta-art/cohub-protocol/realtime";
import {
  dispatchOutboundMessage,
  dispatchRealtimeEventToUsers,
  getProviderMessageRefBySessionMessage,
  getReadableUserIdsForSpace,
  getBindingsBySessionId,
} from "./channels.js";
import { db } from "./db/index.js";
import { spaceChannels } from "./db/schema-v2.js";
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

const dispatchSessionOutputToRealtime = async (output: GatewaySessionOutput) => {
  const readableUserIds = await getReadableUserIdsForSpace(output.spaceId).catch(() => [] as string[]);

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

  if (output.type !== "session.message.persisted") return;
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
