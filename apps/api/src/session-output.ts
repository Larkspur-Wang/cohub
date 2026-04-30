import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MessageRecord } from "@neta-art/cohub-protocol/model";
import type { GatewaySessionOutput } from "@neta-art/cohub-protocol/gateway";
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

export const buildSessionOutputsForStreamEvent = async (
  event: SessionStreamEvent | SessionStreamError,
): Promise<GatewaySessionOutput[]> => {
  if (event.type === "stream_update") {
    return [{
      type: "session.turn.progress",
      spaceId: event.spaceId,
      sessionId: event.sessionId,
      anchorUserMessageId: event.anchorUserMessageId ?? null,
      content: event.content,
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
  if (output.type === "session.turn.progress") {
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "session",
      type: output.type,
      spaceId: output.spaceId,
      sessionId: output.sessionId,
      payload: {
        anchorUserMessageId: output.anchorUserMessageId,
        content: output.content,
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
