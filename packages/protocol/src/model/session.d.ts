import type { ContentBlock } from "../core/content.js";
import type { Usage } from "../core/usage.js";
export type {
  MessageToolCallsFile,
  SessionTurnIntent,
  SessionTurnIntermediateIndex,
  SessionTurnIntermediateSummary,
  SessionTurnIndexItem,
  SessionTurnRecord,
  SessionTurnStatus,
  SessionTurnSummary,
  StoredIntermediateMessage,
  StoredToolCall,
  TurnIntermediateMessagesFile,
} from "./turn.js";

export type SessionPromptInput = {
    spaceId: string;
    sessionId: string;
    userMessageId?: string | null;
    message: {
        content: ContentBlock[];
    };
    meta?: {
        source?: string;
        intent?: "auto" | "continue" | "new_session" | "fork";
        model?: string;
        provider?: string;
    } | null;
};
export type RegisterSessionInput = {
    spaceId: string;
    sessionId: string;
    title?: string | null;
    source?: string | null;
    externalSessionId?: string | null;
    meta?: Record<string, unknown> | null;
};
export type PersistMessageInput = {
    spaceId: string;
    sessionId: string;
    previousMessageId?: string | null;
    anchorUserMessageId?: string | null;
    idempotencyKey: string;
    message: {
        role?: "user" | "assistant" | "system";
        externalMessageId?: string | null;
        protocolMessageId?: string | null;
        content: ContentBlock[];
        text?: string | null;
        provider?: string | null;
        model?: string | null;
        stopReason?: string | null;
        errorMessage?: string | null;
        meta?: Record<string, unknown> | null;
        usage?: Usage | null;
    };
};
export type UpdateSessionInfoInput = {
    spaceId: string;
    sessionId: string;
    title?: string | null;
    updatedAt?: string | null;
    meta?: Record<string, unknown> | null;
};
export type SessionBindingRecord = {
    id: string;
    spaceId: string;
    spaceSessionId: string;
    spaceChannelId: string;
    provider: string;
    bindingKey: string;
    externalChatId: string;
    status: string | null;
    meta: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
    lastMessageAt: string | null;
};
export type SessionRecord = {
    id: string;
    spaceId: string;
    title: string | null;
    source: string | null;
    status: string | null;
    externalSessionId: string | null;
    meta: Record<string, unknown> | null;
    parentSessionId: string | null;
    forkedFromMessageId: string | null;
    lineageRootSessionId: string | null;
    forkDepth: number;
    latestMessageText: string | null;
    lastMessageAt: string | null;
    lastMessageId: string | null;
    createdAt: string;
    updatedAt: string;
};
export type MessageRecord = {
    id: string;
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: ContentBlock[];
    text: string | null;
    sequence: number;
    provider: string | null;
    model: string | null;
    stopReason: string | null;
    errorMessage: string | null;
    usage: Usage | null;
    meta: Record<string, unknown> | null;
    createdAt: string;
};
