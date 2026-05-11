import type { ContentBlock, Usage } from "@neta-art/cohub-protocol/core";
import type {
  MessageRecord,
  SessionTurnRecord,
} from "@neta-art/cohub-protocol/model";
import type { ChannelEnvelope } from "@neta-art/cohub-protocol/realtime";
import { ensureRealtimeConnected } from "./realtime.js";
import {
  SessionPatchReducer,
  type SessionPatchApplyInput,
  type SessionPatchApplyResult,
  type SessionPatchState,
} from "./session-patch-reducer.js";
import type { WebsocketClient, WebsocketEventPayload } from "./websocket.js";

export type AssistantMessageCommit =
  | {
      kind: "intermediate";
      message: MessageRecord;
      isFinal: false;
    }
  | {
      kind: "final";
      message: MessageRecord;
      isFinal: true;
    }
  | {
      kind: "error";
      message: MessageRecord;
      isFinal: true;
    }
  | {
      kind: "ignored";
      message: MessageRecord;
      isFinal: false;
    };

export type GenerationStreamIntermediateMessage = {
  id?: string;
  sessionId?: string;
  role?: "user" | "assistant" | "system";
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
  text?: string | null;
  provider?: string | null;
  model?: string | null;
  stopReason?: string | null;
  errorMessage?: string | null;
  usage?: Usage | null;
  toolCallsObjectKey?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
};

export type GenerationStreamStateEvent = {
  type: "state";
  source: "snapshot" | "patch" | "progress";
  state: SessionPatchState;
  messageId: string | null;
  messageOrdinal: number | null;
  intermediateMessages: GenerationStreamIntermediateMessage[];
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamCommitEvent = {
  type: "commit";
  commit: AssistantMessageCommit;
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamFinalizedEvent = {
  type: "finalized";
  turn: SessionTurnRecord;
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamTurnUpdatedEvent = {
  type: "turn_updated";
  turn: Partial<SessionTurnRecord>;
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamErrorEvent = {
  type: "error";
  message: string;
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamOutOfSyncEvent = {
  type: "out_of_sync";
  source: "snapshot" | "patch";
  reason: "duplicate" | "version_mismatch" | "invalid";
  state: SessionPatchState;
  rawEvent: WebsocketEventPayload;
};

export type GenerationStreamEvent =
  | GenerationStreamStateEvent
  | GenerationStreamCommitEvent
  | GenerationStreamFinalizedEvent
  | GenerationStreamTurnUpdatedEvent
  | GenerationStreamErrorEvent
  | GenerationStreamOutOfSyncEvent;

export type GenerationStreamSubscriptionHandlers = {
  event?: (event: GenerationStreamEvent) => void;
  state?: (event: GenerationStreamStateEvent) => void;
  commit?: (event: GenerationStreamCommitEvent) => void;
  finalized?: (event: GenerationStreamFinalizedEvent) => void;
  turnUpdated?: (event: GenerationStreamTurnUpdatedEvent) => void;
  error?: (event: GenerationStreamErrorEvent) => void;
  outOfSync?: (event: GenerationStreamOutOfSyncEvent) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isContentBlockArray = (value: unknown): value is ContentBlock[] =>
  Array.isArray(value) &&
  value.every((item) => isRecord(item) && typeof item.type === "string");

const stringField = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "string" ? value : null;
};

const numberField = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const getMessageKind = (message: MessageRecord) => {
  const kind = message.meta?.messageKind;
  return typeof kind === "string" ? kind : null;
};

export function parseAssistantMessageCommit(
  message: MessageRecord,
): AssistantMessageCommit {
  if (message.role !== "assistant") {
    return { kind: "ignored", message, isFinal: false };
  }

  const kind = getMessageKind(message);
  if (kind === "assistant_intermediate") {
    return { kind: "intermediate", message, isFinal: false };
  }
  if (kind === "assistant_final") {
    return { kind: "final", message, isFinal: true };
  }
  if (kind === "assistant_error") {
    return { kind: "error", message, isFinal: true };
  }

  return { kind: "ignored", message, isFinal: false };
}

function cloneContentBlock(block: ContentBlock): ContentBlock {
  return structuredClone(block);
}

function getStreamIndex(block: ContentBlock): number | null {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findMergeTargetIndex(result: ContentBlock[], block: ContentBlock) {
  const streamIndex = getStreamIndex(block);
  if (streamIndex != null) {
    return result.findIndex(
      (existing) =>
        existing.type === block.type && getStreamIndex(existing) === streamIndex,
    );
  }
  if (block.type === "tool_use") {
    return result.findIndex(
      (existing) => existing.type === "tool_use" && existing.id === block.id,
    );
  }
  if (block.type === "tool_result") {
    return result.findIndex(
      (existing) =>
        existing.type === "tool_result" &&
        existing.tool_use_id === block.tool_use_id,
    );
  }
  return -1;
}

function mergeStreamingDeltaBlocks(
  existing: ContentBlock[],
  delta: ContentBlock[],
): ContentBlock[] {
  if (delta.length === 0) return existing;
  const result = existing.map(cloneContentBlock);

  for (const block of delta) {
    const targetIndex = findMergeTargetIndex(result, block);
    if (targetIndex === -1) {
      result.push(cloneContentBlock(block));
      continue;
    }

    const target = result[targetIndex];
    if (block.type === "text" && target?.type === "text") {
      target.text += block.text;
      continue;
    }
    if (block.type === "thinking" && target?.type === "thinking") {
      target.thinking += block.thinking;
      if (block.signature) target.signature = block.signature;
      if (block._meta) target._meta = { ...(target._meta ?? {}), ...block._meta };
      continue;
    }

    result[targetIndex] = Object.assign(target ?? {}, cloneContentBlock(block));
  }

  return result;
}

function parseSnapshotMessage(
  value: unknown,
): GenerationStreamIntermediateMessage | null {
  if (!isRecord(value) || !isContentBlockArray(value.content)) return null;
  return {
    messageId: stringField(value, "messageId"),
    messageOrdinal: numberField(value, "messageOrdinal"),
    content: value.content,
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
    ...(value.role === "user" ||
    value.role === "assistant" ||
    value.role === "system"
      ? { role: value.role }
      : {}),
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.stopReason === "string"
      ? { stopReason: value.stopReason }
      : {}),
    ...(typeof value.errorMessage === "string"
      ? { errorMessage: value.errorMessage }
      : {}),
    ...(isRecord(value.usage) ? { usage: value.usage as Usage } : {}),
    ...(typeof value.toolCallsObjectKey === "string"
      ? { toolCallsObjectKey: value.toolCallsObjectKey }
      : {}),
    ...(isRecord(value.meta) ? { meta: value.meta } : {}),
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
  };
}

function messageRecordToIntermediate(
  message: MessageRecord,
): GenerationStreamIntermediateMessage | null {
  if (!isContentBlockArray(message.content) || message.content.length === 0) {
    return null;
  }
  const meta = isRecord(message.meta) ? message.meta : {};
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role,
    messageId:
      typeof meta.streamMessageId === "string"
        ? meta.streamMessageId
        : message.id ?? null,
    messageOrdinal:
      typeof meta.messageOrdinal === "number" ? meta.messageOrdinal : null,
    content: message.content,
    text: message.text,
    provider: message.provider,
    model: message.model,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    usage: message.usage,
    meta: message.meta,
    createdAt: message.createdAt,
  };
}

function resolveStreamMessageId(input: {
  sessionId: string;
  turnId?: string | null;
  anchorUserMessageId?: string | null;
  messageId?: string | null;
  messageOrdinal?: number | null;
}) {
  if (input.messageId?.trim()) return input.messageId.trim();
  if (input.messageOrdinal == null) return null;
  if (input.turnId?.trim()) {
    return `turn:${input.turnId.trim()}:assistant:${input.messageOrdinal}`;
  }
  return `session:${input.sessionId}:assistant:${input.messageOrdinal}:${
    input.anchorUserMessageId ?? "unknown"
  }`;
}

function getTurnIdFromMessage(message: MessageRecord) {
  const turnId = message.meta?.turnId;
  return typeof turnId === "string" ? turnId : null;
}

export class SessionGenerationStreamClient {
  private readonly reducer = new SessionPatchReducer();
  private messageId: string | null = null;
  private messageOrdinal: number | null = null;
  private intermediateMessages: GenerationStreamIntermediateMessage[] = [];
  private progressState: SessionPatchState | null = null;

  constructor(
    private readonly websocketClient: WebsocketClient | null,
    private readonly spaceId: string,
    private readonly sessionId: string,
  ) {}

  subscribe(handlers: GenerationStreamSubscriptionHandlers) {
    if (!this.websocketClient) {
      throw new Error("realtime transport is not configured for this client");
    }
    ensureRealtimeConnected(this.websocketClient);
    const unsubscribe = this.websocketClient.on("event", (event) => {
      if (event.spaceId !== this.spaceId || event.sessionId !== this.sessionId) {
        return;
      }
      this.handleEvent(event, handlers);
    });
    return () => unsubscribe();
  }

  private emit(
    handlers: GenerationStreamSubscriptionHandlers,
    event: GenerationStreamEvent,
  ) {
    handlers.event?.(event);
    if (event.type === "state") handlers.state?.(event);
    if (event.type === "commit") handlers.commit?.(event);
    if (event.type === "finalized") handlers.finalized?.(event);
    if (event.type === "turn_updated") handlers.turnUpdated?.(event);
    if (event.type === "error") handlers.error?.(event);
    if (event.type === "out_of_sync") handlers.outOfSync?.(event);
  }

  private resetCurrentMessage() {
    this.messageId = null;
    this.messageOrdinal = null;
    this.progressState = null;
  }

  private appendCurrentMessage(state: SessionPatchState) {
    if (state.contentBlocks.length === 0) return;
    this.addIntermediateMessage({
      messageId: this.messageId,
      messageOrdinal: this.messageOrdinal,
      content: state.contentBlocks,
    });
  }

  private addIntermediateMessage(message: GenerationStreamIntermediateMessage) {
    const index = this.intermediateMessages.findIndex((existing) => {
      if (message.messageId && existing.messageId) {
        return existing.messageId === message.messageId;
      }
      return (
        message.messageOrdinal !== null &&
        existing.messageOrdinal === message.messageOrdinal
      );
    });
    if (index < 0) {
      this.intermediateMessages = [...this.intermediateMessages, message];
      return;
    }
    this.intermediateMessages = this.intermediateMessages.map((existing, i) =>
      i === index ? { ...existing, ...message } : existing,
    );
  }

  private handleAppliedState(
    handlers: GenerationStreamSubscriptionHandlers,
    source: GenerationStreamStateEvent["source"],
    result: SessionPatchApplyResult,
    rawEvent: WebsocketEventPayload,
    messageId: string | null,
    messageOrdinal: number | null,
  ) {
    if (!result.applied) {
      this.emit(handlers, {
        type: "out_of_sync",
        source: source === "progress" ? "patch" : source,
        reason: result.reason,
        state: result.state,
        rawEvent,
      });
      return;
    }

    this.progressState = result.state;
    this.messageId = messageId;
    this.messageOrdinal = messageOrdinal;
    this.emit(handlers, {
      type: "state",
      source,
      state: result.state,
      messageId,
      messageOrdinal,
      intermediateMessages: [...this.intermediateMessages],
      rawEvent,
    });
  }

  private prepareMessageBoundary(input: {
    turnId: string | null;
    messageId: string | null;
    messageOrdinal: number | null;
    anchorUserMessageId: string | null;
  }) {
    const current =
      this.progressState ??
      this.reducer.get({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
      });
    const nextMessageId = resolveStreamMessageId({
      sessionId: this.sessionId,
      turnId: input.turnId,
      anchorUserMessageId: input.anchorUserMessageId,
      messageId: input.messageId,
      messageOrdinal: input.messageOrdinal,
    });
    const differentTurn = Boolean(
      current.turnId && input.turnId && current.turnId !== input.turnId,
    );
    const messageChanged = Boolean(
      nextMessageId &&
        current.contentBlocks.length > 0 &&
        this.messageId &&
        nextMessageId !== this.messageId,
    );

    if (differentTurn) {
      this.intermediateMessages = [];
      this.resetCurrentMessage();
      this.reducer.start({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: input.turnId,
      });
    } else if (messageChanged) {
      this.appendCurrentMessage(current);
      this.resetCurrentMessage();
      this.reducer.start({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: input.turnId ?? current.turnId,
      });
    }

    return nextMessageId;
  }

  private handleSnapshot(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    const payload = event.payload;
    const current = isRecord(payload.current) ? payload.current : null;
    const content = current ? current.content : null;
    const seq = typeof payload.seq === "number" ? payload.seq : null;
    if (!current || !isContentBlockArray(content) || seq === null) {
      this.emit(handlers, {
        type: "out_of_sync",
        source: "snapshot",
        reason: "invalid",
        state: this.reducer.get({ spaceId: this.spaceId, sessionId: this.sessionId }),
        rawEvent: event,
      });
      return;
    }

    const turnId = typeof payload.turnId === "string" ? payload.turnId : null;
    const anchorUserMessageId =
      typeof payload.anchorUserMessageId === "string"
        ? payload.anchorUserMessageId
        : null;
    const messageOrdinal = numberField(current, "messageOrdinal");
    const messageId = this.prepareMessageBoundary({
      turnId,
      messageId: stringField(current, "messageId"),
      messageOrdinal,
      anchorUserMessageId,
    });
    this.intermediateMessages = Array.isArray(payload.intermediateMessages)
      ? payload.intermediateMessages
          .map(parseSnapshotMessage)
          .filter(
            (message): message is GenerationStreamIntermediateMessage =>
              message !== null,
          )
      : [];

    const result = this.reducer.applySnapshot({
      spaceId: this.spaceId,
      sessionId: this.sessionId,
      turnId,
      seq,
      contentBlocks: content,
      anchorUserMessageId,
      appendPath: stringField(current, "appendPath"),
    });
    this.handleAppliedState(
      handlers,
      "snapshot",
      result,
      event,
      messageId,
      messageOrdinal,
    );
  }

  private handlePatch(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    const payload = event.payload;
    const seq = typeof payload.seq === "number" ? payload.seq : null;
    const baseSeq = typeof payload.baseSeq === "number" ? payload.baseSeq : null;
    if (seq === null || baseSeq === null || !Array.isArray(payload.ops)) {
      this.emit(handlers, {
        type: "out_of_sync",
        source: "patch",
        reason: "invalid",
        state: this.reducer.get({ spaceId: this.spaceId, sessionId: this.sessionId }),
        rawEvent: event,
      });
      return;
    }

    const turnId = typeof payload.turnId === "string" ? payload.turnId : null;
    const anchorUserMessageId =
      typeof payload.anchorUserMessageId === "string"
        ? payload.anchorUserMessageId
        : null;
    const messageOrdinal =
      typeof payload.messageOrdinal === "number" ? payload.messageOrdinal : null;
    const messageId = this.prepareMessageBoundary({
      turnId,
      messageId:
        typeof payload.messageId === "string" ? payload.messageId : null,
      messageOrdinal,
      anchorUserMessageId,
    });

    const input: SessionPatchApplyInput = {
      spaceId: this.spaceId,
      sessionId: this.sessionId,
      turnId,
      seq,
      baseSeq,
      ops: payload.ops as SessionPatchApplyInput["ops"],
      anchorUserMessageId,
    };
    const result = this.reducer.applyPatch(input);
    this.handleAppliedState(
      handlers,
      "patch",
      result,
      event,
      messageId,
      messageOrdinal,
    );
  }

  private handleProgress(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    const payload = event.payload;
    if (!isContentBlockArray(payload.content)) return;
    const current =
      this.progressState ??
      this.reducer.get({ spaceId: this.spaceId, sessionId: this.sessionId });
    const turnId = typeof payload.turnId === "string" ? payload.turnId : current.turnId;
    const anchorUserMessageId =
      typeof payload.anchorUserMessageId === "string"
        ? payload.anchorUserMessageId
        : current.anchorUserMessageId;
    const messageOrdinal =
      typeof payload.messageOrdinal === "number"
        ? payload.messageOrdinal
        : this.messageOrdinal;
    const messageId = this.prepareMessageBoundary({
      turnId,
      messageId:
        typeof payload.messageId === "string" ? payload.messageId : this.messageId,
      messageOrdinal,
      anchorUserMessageId,
    });
    const base =
      this.progressState?.turnId === turnId ? this.progressState : current;
    const state: SessionPatchState = {
      ...base,
      spaceId: this.spaceId,
      sessionId: this.sessionId,
      status: "streaming",
      contentBlocks: mergeStreamingDeltaBlocks(base.contentBlocks, payload.content),
      anchorUserMessageId,
      turnId,
    };
    this.progressState = state;
    this.messageId = messageId;
    this.messageOrdinal = messageOrdinal;
    this.emit(handlers, {
      type: "state",
      source: "progress",
      state,
      messageId,
      messageOrdinal,
      intermediateMessages: [...this.intermediateMessages],
      rawEvent: event,
    });
  }

  private handlePersisted(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    const message = event.payload.message;
    if (!isRecord(message)) return;
    const commit = parseAssistantMessageCommit(message as MessageRecord);

    if (commit.kind === "intermediate") {
      const intermediate = messageRecordToIntermediate(commit.message);
      if (intermediate) {
        this.addIntermediateMessage(intermediate);
      }
      this.reducer.reset({ spaceId: this.spaceId, sessionId: this.sessionId });
      this.resetCurrentMessage();
    }
    if (commit.kind === "final") {
      this.reducer.complete({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: getTurnIdFromMessage(commit.message),
      });
      this.resetCurrentMessage();
    }
    if (commit.kind === "error") {
      this.reducer.fail({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: getTurnIdFromMessage(commit.message),
      });
      this.resetCurrentMessage();
    }

    this.emit(handlers, {
      type: "commit",
      commit,
      rawEvent: event,
    });
  }

  private handleFinalized(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    const turn = event.payload.turn;
    if (!isRecord(turn)) return;
    const typedTurn = turn as SessionTurnRecord;
    if (typedTurn.status === "interrupted") {
      this.reducer.interrupt({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: typedTurn.id,
      });
    } else {
      this.reducer.complete({
        spaceId: this.spaceId,
        sessionId: this.sessionId,
        turnId: typedTurn.id,
      });
    }
    this.resetCurrentMessage();
    this.emit(handlers, {
      type: "finalized",
      turn: typedTurn,
      rawEvent: event,
    });
  }

  private handleEvent(
    event: WebsocketEventPayload,
    handlers: GenerationStreamSubscriptionHandlers,
  ) {
    switch (event.type) {
      case "session.turn.snapshot":
        this.handleSnapshot(event, handlers);
        return;
      case "session.turn.patch":
        this.handlePatch(event, handlers);
        return;
      case "session.turn.progress":
        this.handleProgress(event, handlers);
        return;
      case "session.message.persisted":
        this.handlePersisted(event, handlers);
        return;
      case "session.turn.finalized":
        this.handleFinalized(event, handlers);
        return;
      case "session.turn.updated": {
        const turn = event.payload.turn;
        if (!isRecord(turn)) return;
        this.emit(handlers, {
          type: "turn_updated",
          turn: turn as Partial<SessionTurnRecord>,
          rawEvent: event,
        });
        return;
      }
      case "session.turn.error": {
        const message =
          typeof event.payload.error === "string" && event.payload.error.trim()
            ? event.payload.error.trim()
            : "Generation failed";
        this.reducer.fail({ spaceId: this.spaceId, sessionId: this.sessionId });
        this.resetCurrentMessage();
        this.emit(handlers, {
          type: "error",
          message,
          rawEvent: event,
        });
        return;
      }
      default:
        return;
    }
  }
}

export function createSessionGenerationStreamClient(input: {
  websocketClient: WebsocketClient | null;
  spaceId: string;
  sessionId: string;
}) {
  return new SessionGenerationStreamClient(
    input.websocketClient,
    input.spaceId,
    input.sessionId,
  );
}
