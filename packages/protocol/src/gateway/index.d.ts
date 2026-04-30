import type { ContentBlock } from "../core/content.js";
import type { MessageRecord } from "../model/session.js";
export type ChannelProvider = "web" | "websocket" | "discord" | "feishu" | "telegram" | "slack";
export interface DiscordChannelConfig {
    inbound?: {
        requireMentionInGuild?: boolean;
    };
    outbound?: {
        showThinking?: boolean;
        showToolCalls?: boolean;
    };
}
export interface FeishuChannelConfig {
    brand?: "feishu" | "lark";
    inbound?: {
        requireMentionInGroup?: boolean;
    };
    outbound?: {
        renderMode?: "card" | "post";
        showThinking?: boolean;
        showToolCalls?: boolean;
    };
}
export type ChannelConfig = DiscordChannelConfig | FeishuChannelConfig | Record<string, unknown>;
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
    content: ContentBlock[];
    meta?: Record<string, unknown> | null;
}
export interface GatewaySessionOutputBase {
    type: "session.turn.progress" | "session.turn.error" | "session.message.persisted";
    spaceId: string;
    sessionId: string;
}
export interface GatewaySessionTurnProgressOutput extends GatewaySessionOutputBase {
    type: "session.turn.progress";
    anchorUserMessageId: string | null;
    content: ContentBlock[];
}
export interface GatewaySessionTurnErrorOutput extends GatewaySessionOutputBase {
    type: "session.turn.error";
    anchorUserMessageId: string | null;
    error: string;
}
export interface GatewaySessionMessagePersistedOutput extends GatewaySessionOutputBase {
    type: "session.message.persisted";
    message: MessageRecord;
}
export type GatewaySessionOutput = GatewaySessionTurnProgressOutput | GatewaySessionTurnErrorOutput | GatewaySessionMessagePersistedOutput;
export interface GatewayOutboundCommand {
    commandId: string;
    timestamp: number;
    channelId: string;
    provider: ChannelProvider;
    externalChatId: string;
    content: ContentBlock[];
    replyToExternalMessageId?: string;
    spaceId?: string;
    spaceSessionId?: string;
    sessionMessageId?: string;
    meta?: (Record<string, unknown> & {
        sessionOutput?: GatewaySessionOutput | null;
    }) | null;
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
    correlationId?: string;
}
