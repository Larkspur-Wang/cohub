export type { ContentBlock } from "../core/content.js";
export type { Usage } from "../core/usage.js";
import type { ContentBlock } from "../core/content.js";
import type { Usage } from "../core/usage.js";

export type SessionTurnStatus = "running" | "completed" | "failed" | "interrupted";
export type SessionTurnIntent = "steer" | "followup";
export type SessionTurnSummary = {
  text?: string | null;
  finishReason?: "completed" | "failed" | "interrupted";
  interruptedByTurnId?: string | null;
};
export type SessionTurnIntermediateIndex = {
  version: 1;
  messagesObjectKey: string | null;
  messagesSizeBytes?: number | null;
  toolCallsBaseObjectKey?: string | null;
};
export type SessionTurnIntermediateSummary = {
  messageCount: number;
  toolCallCount: number;
  usage?: Usage | null;
  lastMessageText?: string | null;
  hasError?: boolean;
};
export type StoredIntermediateMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  text: string | null;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usage: Usage | null;
  toolCallsObjectKey: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};
export type StoredToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  meta: Record<string, unknown> | null;
  result: {
    content: string | ContentBlock[] | null;
    isError: boolean;
    meta: Record<string, unknown> | null;
  } | null;
};
export type MessageToolCallsFile = {
  version: 1;
  spaceId: string;
  sessionId: string;
  turnId: string;
  messageId: string;
  toolCalls: StoredToolCall[];
};
export type TurnIntermediateMessagesFile = {
  version: 1;
  spaceId: string;
  sessionId: string;
  turnId: string;
  summary: SessionTurnIntermediateSummary;
  messages: StoredIntermediateMessage[];
};
export type SessionTurnIndexItem = {
  id: string;
  sessionId: string;
  sequence: number;
  status: SessionTurnStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  userPreview: string | null;
  assistantPreview: string | null;
  provider: string | null;
  model: string | null;
  usage: Usage | null;
  errorMessage: string | null;
};
export type SessionTurnRecord = {
  id: string;
  sessionId: string;
  userUuid: string | null;
  sequence: number;
  status: SessionTurnStatus;
  intent: SessionTurnIntent;
  userContent: ContentBlock[];
  userText: string | null;
  assistantContent: ContentBlock[] | null;
  assistantText: string | null;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usage: Usage | null;
  summary: SessionTurnSummary | null;
  intermediateIndex: SessionTurnIntermediateIndex | null;
  intermediateSummary: SessionTurnIntermediateSummary | null;
  meta: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
