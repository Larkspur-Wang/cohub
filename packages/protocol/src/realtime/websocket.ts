import { z } from "zod";
import type { ContentBlock } from "../core/content.js";
import type { MessageRecord } from "../model/session.js";
import type { SpaceFsChangedPayload } from "../fs/index.js";

const contentBlockMetaSchema = z.record(z.string(), z.unknown());

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("thinking"),
    thinking: z.string(),
    signature: z.string().optional(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("image"),
    source: z.union([
      z.object({ type: z.literal("url"), url: z.string().url() }),
      z.object({ type: z.literal("base64"), media_type: z.string(), data: z.string() }),
    ]),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.unknown())]),
    is_error: z.boolean().optional(),
    _meta: contentBlockMetaSchema.optional(),
  }),
  z.object({
    type: z.literal("system_note"),
    note_type: z.enum(["session_created", "forked", "compacted", "info"]),
    text: z.string(),
    _meta: contentBlockMetaSchema.optional(),
  }),
]);

export const wsClientEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    requestId: z.string().optional(),
    payload: z.object({ token: z.string().min(1) }),
  }),
  z.object({
    type: z.literal("session.message.create"),
    requestId: z.string().optional(),
    payload: z.object({
      spaceId: z.string().uuid(),
      sessionId: z.string().uuid(),
      clientMessageId: z.string().optional(),
      content: z.array(contentBlockSchema).min(1),
      model: z.string().optional(),
      provider: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("ping"),
    requestId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("ack"),
    requestId: z.string().optional(),
    payload: z.object({
      eventId: z.string().optional(),
    }).optional(),
  }),
]);

export const realtimeEnvelopeSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  domain: z.enum(["system", "session", "space"]),
  type: z.string(),
  requestId: z.string().nullable().optional(),
  spaceId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const channelEnvelopeSchema = realtimeEnvelopeSchema;

export type WsClientEvent =
  | { type: "auth"; requestId?: string; payload: { token: string } }
  | { type: "session.message.create"; requestId?: string; payload: { spaceId: string; sessionId: string; clientMessageId?: string; content: ContentBlock[]; model?: string; provider?: string } }
  | { type: "ping"; requestId?: string; payload?: Record<string, unknown> }
  | { type: "ack"; requestId?: string; payload?: { eventId?: string } };

export type RealtimeEnvelope = z.output<typeof realtimeEnvelopeSchema>;
export type ChannelEnvelope = RealtimeEnvelope;
export type RealtimeEnvelopeBase = RealtimeEnvelope;
export type RealtimeDomain = RealtimeEnvelopeBase["domain"];

export type SystemReadyEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.ready";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: {
    connectionId: string;
  };
};

export type SystemAuthOkEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.auth.ok";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: {
    connectionId: string;
    user: Record<string, unknown>;
  };
};

export type SystemRequestErrorEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.request.error";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: {
    code: string;
    message: string;
  };
};

export type SystemPongEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.pong";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: Record<string, never>;
};

export type SystemAckOkEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.ack.ok";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: Record<string, never>;
};

export type SessionRequestAcceptedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.request.accepted";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    clientMessageId?: string | null;
  };
};

export type SessionRequestErrorEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.request.error";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: {
    code: string;
    message: string;
    clientMessageId?: string | null;
  };
};

export type SessionTurnProgressEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.progress";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    anchorUserMessageId: string | null;
    content: ContentBlock[];
  };
};

export type SessionTurnErrorEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.error";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    anchorUserMessageId: string | null;
    error: string;
  };
};

export type RealtimeMessageRecord = Pick<
  MessageRecord,
  | "id"
  | "sessionId"
  | "role"
  | "content"
  | "text"
  | "sequence"
  | "provider"
  | "model"
  | "stopReason"
  | "errorMessage"
  | "usage"
  | "meta"
  | "createdAt"
>;

export type SessionMessagePersistedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.message.persisted";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    message: RealtimeMessageRecord;
  };
};

export type SpaceFsChangedEvent = {
  id: string;
  timestamp: number;
  domain: "space";
  type: "space.fs.changed";
  requestId?: string | null;
  spaceId: string;
  sessionId?: string | null;
  payload: SpaceFsChangedPayload;
};

export type RealtimeServerEvent =
  | SystemReadyEvent
  | SystemAuthOkEvent
  | SystemRequestErrorEvent
  | SystemPongEvent
  | SystemAckOkEvent
  | SessionRequestAcceptedEvent
  | SessionRequestErrorEvent
  | SessionTurnProgressEvent
  | SessionTurnErrorEvent
  | SessionMessagePersistedEvent
  | SpaceFsChangedEvent;

export type WsServerEnvelope = RealtimeEnvelope;
export type ChannelServerEnvelope = ChannelEnvelope;
