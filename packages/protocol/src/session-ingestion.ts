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

// ─── Backward compatibility alias ───
/** @deprecated Use ContentBlock instead */
export type UnifiedContentBlock = ContentBlock;

// ─── Input types ───

export type ProtocolSource = "pi" | "acp" | "internal";

export type RuntimePromptInput = {
  runtimeId: string;
  sessionId: string;
  userMessageId?: string | null;
  message: {
    text: string;
    images?: Array<{ url: string }>;
  };
  meta?: {
    source?: string;
    intent?: "auto" | "continue" | "new_session" | "fork";
  } | null;
};

export type RegisterRuntimeSessionInput = {
  runtimeId: string;
  sessionId: string;
  title?: string | null;
  source?: string | null;
  protocol?: ProtocolSource | null;
  externalSessionId?: string | null;
  cwd?: string | null;
  meta?: Record<string, unknown> | null;
};

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

export type PersistSessionInfoUpdateInput = {
  runtimeId: string;
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, unknown> | null;
};
