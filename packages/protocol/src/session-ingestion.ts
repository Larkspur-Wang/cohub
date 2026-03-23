export type ProtocolSource = "pi" | "acp" | "internal";

export type UnifiedContentBlock =
  | {
      type: "text";
      text: string;
      annotations?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    }
  | {
      type: "image";
      mimeType?: string;
      data?: string;
      uri?: string;
      annotations?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    }
  | {
      type: "resource";
      resource: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
        _meta?: Record<string, unknown>;
      };
      _meta?: Record<string, unknown>;
    }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      title?: string;
      description?: string;
      size?: number;
      annotations?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };

export type ToolCallContentBlock =
  | {
      type: "content";
      content: UnifiedContentBlock;
      _meta?: Record<string, unknown>;
    }
  | {
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
      _meta?: Record<string, unknown>;
    };

export type RuntimePromptInput = {
  runtimeId: string;
  sessionId?: string | null;
  userMessageId?: string | null;
  branchFromMessageId?: string | null;
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
  protocol?: ProtocolSource | null;
  externalSessionId?: string | null;
  cwd?: string | null;
  meta?: Record<string, unknown> | null;
};

export type PersistMessageInput = {
  runtimeId: string;
  sessionId: string;
  parentMessageId: string;
  idempotencyKey: string;
  message: {
    role?: "user" | "assistant" | "system";
    source?: ProtocolSource | null;
    externalMessageId?: string | null;
    content: UnifiedContentBlock[];
    text?: string | null;
    provider?: string | null;
    model?: string | null;
    stopReason?: string | null;
    errorMessage?: string | null;
    meta?: Record<string, unknown> | null;
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      costTotal?: number;
    } | null;
  };
  toolCalls?: PersistToolCall[];
};

export type PersistToolCall = {
  toolCallId: string;
  toolName: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  args?: unknown;
  result?: unknown;
  content?: ToolCallContentBlock[] | null;
  locations?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  resultPreview?: string | null;
  isError?: boolean;
  meta?: Record<string, unknown> | null;
};

export type PersistToolCallsInput = {
  runtimeId: string;
  sessionId: string;
  messageId: string;
  toolCalls: PersistToolCall[];
};

export type PersistSessionInfoUpdateInput = {
  runtimeId: string;
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
  meta?: Record<string, unknown> | null;
};
