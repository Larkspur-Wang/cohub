// ─── Content Block — Anthropic-style, single source of truth ───

export type ContentBlockMeta = Record<string, unknown>;

export type ContentBlock =
  // ─── 文本 ───
  | { type: "text"; text: string; _meta?: ContentBlockMeta }

  // ─── 思考 ───
  | { type: "thinking"; thinking: string; signature?: string; _meta?: ContentBlockMeta }

  // ─── 图片 ───
  | {
      type: "image";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; media_type: string; data: string };
      _meta?: ContentBlockMeta;
    }

  // ─── 工具调用（对标 Anthropic tool_use） ───
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      _meta?: ContentBlockMeta;
    }

  // ─── 工具结果（对标 Anthropic tool_result） ───
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
      _meta?: ContentBlockMeta;
    }

  // ─── 系统注解（cohub 扩展） ───
  | {
      type: "system_note";
      note_type: "session_created" | "forked" | "compacted" | "info";
      text: string;
      _meta?: ContentBlockMeta;
    };

// ─── Protocol types ───

export type RuntimeProtocol = "pi" | "acp" | "internal";

// ─── Session prompt input (API → Agent queue) ───

export type SessionPromptInput = {
  runtimeId: string;
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

// ─── Session registration ───

export type RegisterSessionInput = {
  runtimeId: string;
  sessionId: string;
  title?: string | null;
  source?: string | null;
  protocol?: RuntimeProtocol | null;
  externalSessionId?: string | null;
  cwd?: string | null;
  meta?: Record<string, unknown> | null;
};

// ─── Message persistence (Agent → API) ───

export type PersistMessageInput = {
  runtimeId: string;
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
    usage?: {
      input?: number;
      output?: number;
      costTotal?: number;
    } | null;
  };
};

// ─── Session info update ───

export type UpdateSessionInfoInput = {
  runtimeId: string;
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, unknown> | null;
};

// ─── Session stream events (Agent → Redis Stream → API SSE → Web) ───

export type SessionStreamEvent = {
  type: "stream_update";
  runtimeId: string;
  sessionId: string;
  /** 当前助手消息的完整 content blocks（增量快照） */
  content: ContentBlock[];
  sourceMessageId: string | null;
  timestamp: number;
  turnEnd?: boolean;
  anchorUserMessageId?: string | null;
};

export type SessionStreamError = {
  type: "error";
  runtimeId: string;
  sessionId: string | null;
  error: string;
};

// ─── Record types (read-only DB projections) ───

export type SessionBindingRecord = {
  id: string;
  runtimeId: string;
  runtimeSessionId: string;
  runtimeChannelId: string;
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
  runtimeId: string;
  title: string | null;
  source: string | null;
  status: string | null;
  cwd: string | null;
  protocol: string | null;
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
  usageInput: number | null;
  usageOutput: number | null;
  costTotal: string | null;
  createdAt: string;
};

export type RuntimeRecord = {
  id: string;
  userUuid: string;
  workspaceId: string | null;
  workspaceCommitHash: string | null;
  agentId: string | null;
  agentCommitHash: string | null;
  title: string | null;
  status: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
