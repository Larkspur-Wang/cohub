// ─── Content Block — Anthropic-style, single source of truth ───

export type ContentBlockMeta = Record<string, unknown>;

export type ContentBlock =
  | { type: "text"; text: string; _meta?: ContentBlockMeta }
  | { type: "thinking"; thinking: string; signature?: string; _meta?: ContentBlockMeta }
  | {
      type: "image";
      source:
        | { type: "url"; url: string }
        | { type: "base64"; media_type: string; data: string };
      _meta?: ContentBlockMeta;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      _meta?: ContentBlockMeta;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
      _meta?: ContentBlockMeta;
    }
  | {
      type: "system_note";
      note_type: "session_created" | "forked" | "compacted" | "info";
      text: string;
      _meta?: ContentBlockMeta;
    };

export type SessionProtocol = "pi" | "acp" | "internal";

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
  protocol?: SessionProtocol | null;
  externalSessionId?: string | null;
  cwd?: string | null;
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
    usage?: {
      input?: number;
      output?: number;
      costTotal?: number;
    } | null;
  };
};

export type UpdateSessionInfoInput = {
  spaceId: string;
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, unknown> | null;
};

export type SessionStreamEvent = {
  type: "stream_update";
  spaceId: string;
  sessionId: string;
  content: ContentBlock[];
  sourceMessageId: string | null;
  timestamp: number;
  turnEnd?: boolean;
  anchorUserMessageId?: string | null;
};

export type SessionStreamError = {
  type: "error";
  spaceId: string;
  sessionId: string | null;
  error: string;
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
  meta: Record<string, unknown> | null;
  createdAt: string;
};
