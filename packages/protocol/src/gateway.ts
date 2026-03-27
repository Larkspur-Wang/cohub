export type ChannelProvider = "web" | "discord" | "feishu" | "telegram" | "slack";

export interface DiscordRuntimeChannelConfig {
  inbound?: {
    requireMentionInGuild?: boolean;
  };
  outbound?: {
    showThinking?: boolean;
    showToolCalls?: boolean;
    defaultDisplayMode?: "full" | "compact" | "minimal";
  };
}

export type RuntimeChannelConfig = DiscordRuntimeChannelConfig | Record<string, unknown>;

export interface GatewayInboundEvent {
  eventId: string;
  timestamp: number;
  eventType?: "message_create" | "conversation_create";

  channelId: string;
  provider: ChannelProvider;
  externalChatId: string;
  externalMessageId: string;
  bindingKey?: string;

  conversation: {
    id: string;
    parentId?: string | null;
    meta?: Record<string, unknown> | null;
  };
  message?: {
    parentMessageId?: string | null;
    meta?: Record<string, unknown> | null;
  };

  sender: {
    id: string;
    name?: string;
  };
  content: import("./session-ingestion.js").UnifiedContentBlock[];
  meta?: Record<string, unknown> | null;
}

export interface GatewayOutboundCommand {
  commandId: string;
  timestamp: number;

  channelId: string;
  provider: ChannelProvider;
  externalChatId: string;

  content: import("./session-ingestion.js").UnifiedContentBlock[];

  replyToExternalMessageId?: string;
  runtimeId?: string;
  runtimeSessionId?: string;
  sessionMessageId?: string;
  meta?: Record<string, unknown> | null;
}

export interface GatewayControlCommand {
  action: "connect" | "disconnect" | "reload";
  configs: {
    channelId: string;
    provider: ChannelProvider;
    credentials: Record<string, unknown>;
  }[];
}

export type GatewayLogDirection = "inbound" | "outbound";
export type GatewayLogStatus = "pending" | "success" | "failed";

export interface GatewayLogEvent {
  logId: string;
  timestamp: number;
  direction: GatewayLogDirection;
  provider: ChannelProvider;
  channelId: string;
  externalChatId: string;
  externalMessageId?: string;

  rawPayload: Record<string, unknown>;
  normalizedPayload?: Record<string, unknown>;

  status: GatewayLogStatus;
  errorMessage?: string;

  /** 关联的事件/命令 ID，便于追踪 */
  correlationId?: string;
}
