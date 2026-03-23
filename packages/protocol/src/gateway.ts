export type ChannelProvider = "web" | "discord" | "feishu" | "telegram" | "slack";

export interface GatewayInboundEvent {
  eventId: string;
  timestamp: number;

  channelId: string;
  provider: ChannelProvider;
  externalChatId: string;
  externalMessageId: string;
  bindingKey?: string;

  sender: {
    id: string;
    name?: string;
  };
  content: import("./session-ingestion.js").UnifiedContentBlock[];
}

export interface GatewayOutboundCommand {
  commandId: string;
  timestamp: number;

  channelId: string;
  provider: ChannelProvider;
  externalChatId: string;

  content: import("./session-ingestion.js").UnifiedContentBlock[];

  replyToExternalMessageId?: string;
}

export interface GatewayControlCommand {
  action: "connect" | "disconnect" | "reload";
  configs: {
    channelId: string;
    provider: ChannelProvider;
    credentials: Record<string, unknown>;
  }[];
}
