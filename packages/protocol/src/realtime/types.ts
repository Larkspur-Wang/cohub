import type { ContentBlock } from "../core/content.js";
import type { MessageRecord, SessionRecord, SessionTurnRecord } from "../model/session.js";
import type { TaskRunStatus } from "../task/index.js";
import type { SpaceFsChangedPayload } from "../fs/index.js";
import type { SpacePortsChangedPayload } from "../ports/index.js";

export const WS_COMPACT_STREAM_CAPABILITY = "session.compact_stream.v1";

export type WsClientEvent =
  | { type: "auth"; requestId?: string; payload: { token: string; capabilities?: string[] } }
  | { type: "session.message.create"; requestId?: string; payload: { spaceId: string; sessionId: string; clientMessageId?: string; content: ContentBlock[]; model?: string; provider?: string } }
  | { type: "ping"; requestId?: string; payload?: Record<string, unknown> }
  | { type: "ack"; requestId?: string; payload?: { eventId?: string } };

export type RealtimeEnvelope = {
  id: string;
  timestamp: number;
  domain: "system" | "session" | "space" | "label";
  type: string;
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: Record<string, unknown>;
};

export type ChannelEnvelope = RealtimeEnvelope;
export type RealtimeEnvelopeBase = RealtimeEnvelope;
export type RealtimeDomain = RealtimeEnvelopeBase["domain"];

export type RealtimeCompactFrame =
  | { t: "d"; sid: string; s: number; b: number; v: unknown }
  | { t: "p"; sid: string; s: number; b: number; o: "append" | "replace" | "add" | "merge" | "remove"; p: string; v?: unknown };

export type SystemReadyEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.ready";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { connectionId: string };
};

export type SystemAuthOkEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.auth.ok";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { connectionId: string; user: Record<string, unknown> };
};

export type SystemRequestErrorEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.request.error";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { code?: string; message: string };
};

export type SystemPongEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.pong";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: Record<string, unknown>;
};

export type SystemAckOkEvent = {
  id: string;
  timestamp: number;
  domain: "system";
  type: "system.ack.ok";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { eventId?: string };
};

export type RealtimeSessionRecord = Pick<
  SessionRecord,
  | "id"
  | "spaceId"
  | "userUuid"
  | "title"
  | "source"
  | "status"
  | "externalSessionId"
  | "latestMessageText"
  | "lastMessageAt"
  | "lastMessageId"
  | "createdAt"
  | "updatedAt"
>;

export type SessionCreatedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.created";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { session: RealtimeSessionRecord };
};

export type SessionUpdatedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.updated";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { session: RealtimeSessionRecord; changed: string[] };
};

export type SessionRequestAcceptedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.request.accepted";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { clientMessageId?: string | null; turnId?: string | null; userMessageId?: string | null; traceId?: string | null };
};

export type SessionRequestErrorEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.request.error";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { code?: string; message: string; clientMessageId?: string | null };
};

export type RealtimePatchOperation =
  | { o: "append"; p: string; v: unknown }
  | { o: "replace"; p: string; v: unknown }
  | { o: "add"; p: string; v: unknown }
  | { o: "merge"; p: string; v: Record<string, unknown> }
  | { o: "remove"; p: string }
  | { v: unknown; o?: undefined; p?: undefined };

export type RealtimePatchIdentityInput = {
  turnId?: unknown;
  messageId?: unknown;
  sourceMessageId?: unknown;
  anchorUserMessageId?: unknown;
  messageOrdinal?: unknown;
  sessionId?: unknown;
};

const getNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

export const getSessionTurnPatchStreamKey = (
  input: RealtimePatchIdentityInput,
  options: { includeSessionFallback?: boolean } = {},
) => {
  const turnId = getNonEmptyString(input.turnId);
  const messageKey =
    getNonEmptyString(input.messageId) ??
    getNonEmptyString(input.sourceMessageId) ??
    getNonEmptyString(input.anchorUserMessageId) ??
    (typeof input.messageOrdinal === "number" && Number.isFinite(input.messageOrdinal)
      ? `ordinal:${input.messageOrdinal}`
      : null);

  if (turnId && messageKey) return `${turnId}:${messageKey}`;
  const streamKey = messageKey ?? turnId;
  if (streamKey) return streamKey;
  return options.includeSessionFallback ? getNonEmptyString(input.sessionId) : null;
};

export type SessionTurnPatchEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.patch";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    turnId: string | null;
    messageId: string | null;
    messageOrdinal?: number | null;
    sourceMessageId?: string | null;
    anchorUserMessageId: string | null;
    seq: number;
    baseSeq: number;
    ops: RealtimePatchOperation[];
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
  payload: { turnId?: string | null; anchorUserMessageId: string | null; error: string };
};

export type SessionTurnLifecyclePhase = "llm_call_started";

export type SessionTurnLifecycleEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.lifecycle";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: {
    turnId: string | null;
    anchorUserMessageId: string | null;
    phase: SessionTurnLifecyclePhase;
    llmRound: number;
    provider: string | null;
    model: string | null;
    at: string;
  };
};

export type RealtimeTurnRecord = Partial<Pick<
  SessionTurnRecord,
  | "id"
  | "sessionId"
  | "sequence"
  | "status"
  | "intent"
  | "userUuid"
  | "authorProfile"
  | "userContent"
  | "userText"
  | "assistantContent"
  | "assistantText"
  | "provider"
  | "model"
  | "stopReason"
  | "errorMessage"
  | "finalUsage"
  | "totalUsage"
  | "summary"
  | "intermediateIndex"
  | "intermediateSummary"
  | "meta"
  | "startedAt"
  | "completedAt"
  | "durationMs"
  | "createdAt"
  | "updatedAt"
>>;

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
  | "startedAt"
  | "completedAt"
  | "durationMs"
  | "createdAt"
>;

export type SessionTurnCreatedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.created";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { turn: RealtimeTurnRecord };
};

export type SessionTurnUpdatedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.updated";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { turn: RealtimeTurnRecord };
};

export type SessionTurnFinalizedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.turn.finalized";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { turn: RealtimeTurnRecord };
};

export type SessionMessagePersistedEvent = {
  id: string;
  timestamp: number;
  domain: "session";
  type: "session.message.persisted";
  requestId?: string | null;
  spaceId: string;
  sessionId: string;
  payload: { message: RealtimeMessageRecord };
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

export type SpacePortsChangedEvent = {
  id: string;
  timestamp: number;
  domain: "space";
  type: "space.ports.changed";
  requestId?: string | null;
  spaceId: string;
  sessionId?: string | null;
  payload: SpacePortsChangedPayload;
};

export type RealtimeTaskRecord = {
  id: string;
  type: string;
  status: TaskRunStatus;
  jobId: string;
  cronJobId: string | null;
  spaceId: string | null;
  sessionId: string | null;
  turnId: string | null;
  userId: string | null;
  attemptCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskCreatedEvent = {
  id: string;
  timestamp: number;
  domain: "space";
  type: "task.created";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { task: RealtimeTaskRecord };
};

export type TaskUpdatedEvent = {
  id: string;
  timestamp: number;
  domain: "space";
  type: "task.updated";
  requestId?: string | null;
  spaceId?: string | null;
  sessionId?: string | null;
  payload: { task: RealtimeTaskRecord; changed: string[] };
};

export type LabelAssignmentsUpdatedEvent = {
  id: string;
  timestamp: number;
  domain: "label";
  type: "label.assignments.updated";
  requestId?: string | null;
  spaceId: string;
  sessionId?: string | null;
  payload: {
    resourceType: "session" | "checkpoint" | "file";
    resourceRef: string;
    labels: unknown[];
    assignments: unknown[];
    items?: unknown[];
    affectedLabelIds: string[];
  };
};

export type RealtimeServerEvent =
  | SystemReadyEvent
  | SystemAuthOkEvent
  | SystemRequestErrorEvent
  | SystemPongEvent
  | SystemAckOkEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionRequestAcceptedEvent
  | SessionRequestErrorEvent
  | SessionTurnCreatedEvent
  | SessionTurnPatchEvent
  | SessionTurnErrorEvent
  | SessionTurnLifecycleEvent
  | SessionTurnUpdatedEvent
  | SessionTurnFinalizedEvent
  | SessionMessagePersistedEvent
  | SpaceFsChangedEvent
  | SpacePortsChangedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | LabelAssignmentsUpdatedEvent;

export type WsServerEnvelope = RealtimeEnvelope;
export type ChannelServerEnvelope = ChannelEnvelope;
