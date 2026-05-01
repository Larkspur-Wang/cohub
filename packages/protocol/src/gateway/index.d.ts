import type { ContentBlock } from "../core/content.js";
import type { MessageRecord } from "../model/session.js";
import { z } from "zod";
export type ChannelProvider = "web" | "websocket" | "discord" | "feishu" | "telegram" | "slack";
export declare const GATEWAY_CHANNEL_COMMAND_SPECS: readonly [{
    readonly name: "new";
    readonly slash: "/new";
    readonly description: "Start a new Cohub session for this conversation.";
}, {
    readonly name: "status";
    readonly slash: "/status";
    readonly description: "Show the current Cohub session status.";
}];
export type GatewayChannelCommandName = typeof GATEWAY_CHANNEL_COMMAND_SPECS[number]["name"];
export interface GatewayChannelCommand {
    name: GatewayChannelCommandName;
    rawText?: string;
    args?: string;
}
export type GatewayInboundBinding = {
    key: string;
    parentKey?: string | null;
};
export declare const gatewayChannelCommandNameSchema: z.ZodEnum<{
    new: "new";
    status: "status";
}>;
export declare const gatewayChannelCommandSchema: z.ZodObject<{
    name: z.ZodEnum<{
        new: "new";
        status: "status";
    }>;
    rawText: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const gatewayMessageCreateEventSchema: z.ZodObject<{
    eventId: z.ZodString;
    timestamp: z.ZodNumber;
    channelId: z.ZodString;
    provider: z.ZodEnum<{
        web: "web";
        websocket: "websocket";
        discord: "discord";
        feishu: "feishu";
        telegram: "telegram";
        slack: "slack";
    }>;
    externalChatId: z.ZodString;
    externalMessageId: z.ZodString;
    bindingKey: z.ZodOptional<z.ZodString>;
    binding: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        parentKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    conversation: z.ZodObject<{
        id: z.ZodString;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>;
    message: z.ZodOptional<z.ZodObject<{
        parentMessageId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>>;
    sender: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    content: z.ZodArray<z.ZodType<ContentBlock>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    eventType: z.ZodLiteral<"message_create">;
    command: z.ZodOptional<z.ZodNever>;
}, z.core.$loose>;
export declare const gatewayConversationCreateEventSchema: z.ZodObject<{
    eventId: z.ZodString;
    timestamp: z.ZodNumber;
    channelId: z.ZodString;
    provider: z.ZodEnum<{
        web: "web";
        websocket: "websocket";
        discord: "discord";
        feishu: "feishu";
        telegram: "telegram";
        slack: "slack";
    }>;
    externalChatId: z.ZodString;
    externalMessageId: z.ZodString;
    bindingKey: z.ZodOptional<z.ZodString>;
    binding: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        parentKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    conversation: z.ZodObject<{
        id: z.ZodString;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>;
    message: z.ZodOptional<z.ZodObject<{
        parentMessageId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>>;
    sender: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    content: z.ZodArray<z.ZodType<ContentBlock>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    eventType: z.ZodLiteral<"conversation_create">;
    command: z.ZodOptional<z.ZodNever>;
}, z.core.$loose>;
export declare const gatewayChannelCommandEventSchema: z.ZodObject<{
    eventId: z.ZodString;
    timestamp: z.ZodNumber;
    channelId: z.ZodString;
    provider: z.ZodEnum<{
        web: "web";
        websocket: "websocket";
        discord: "discord";
        feishu: "feishu";
        telegram: "telegram";
        slack: "slack";
    }>;
    externalChatId: z.ZodString;
    externalMessageId: z.ZodString;
    bindingKey: z.ZodOptional<z.ZodString>;
    binding: z.ZodOptional<z.ZodObject<{
        key: z.ZodString;
        parentKey: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    conversation: z.ZodObject<{
        id: z.ZodString;
        parentId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>;
    message: z.ZodOptional<z.ZodObject<{
        parentMessageId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    }, z.core.$strip>>;
    sender: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    content: z.ZodArray<z.ZodType<ContentBlock>>;
    meta: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    eventType: z.ZodLiteral<"channel_command">;
    command: z.ZodObject<{
        name: z.ZodEnum<{
            new: "new";
            status: "status";
        }>;
        rawText: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$loose>;
export declare const gatewayInboundEventSchema: z.ZodDiscriminatedUnion<[typeof gatewayMessageCreateEventSchema, typeof gatewayConversationCreateEventSchema, typeof gatewayChannelCommandEventSchema], "eventType">;
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
export interface GatewayInboundEventBase {
    eventId: string;
    timestamp: number;
    channelId: string;
    provider: ChannelProvider;
    externalChatId: string;
    externalMessageId: string;
    bindingKey?: string;
    binding?: GatewayInboundBinding;
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
export interface GatewayMessageCreateEvent extends GatewayInboundEventBase {
    eventType: "message_create";
    command?: never;
}
export interface GatewayConversationCreateEvent extends GatewayInboundEventBase {
    eventType: "conversation_create";
    command?: never;
}
export interface GatewayChannelCommandEvent extends GatewayInboundEventBase {
    eventType: "channel_command";
    command: GatewayChannelCommand;
}
export type GatewayInboundEvent = GatewayMessageCreateEvent | GatewayConversationCreateEvent | GatewayChannelCommandEvent;
export interface GatewaySessionOutputBase {
    type: "session.turn.patch" | "session.turn.error" | "session.message.persisted";
    spaceId: string;
    sessionId: string;
}
export type GatewaySessionPatchOperation = {
    o: "append";
    p: string;
    v: unknown;
} | {
    o: "replace";
    p: string;
    v: unknown;
} | {
    o: "add";
    p: string;
    v: unknown;
} | {
    o: "merge";
    p: string;
    v: Record<string, unknown>;
} | {
    o: "remove";
    p: string;
} | {
    v: unknown;
    o?: undefined;
    p?: undefined;
};
export interface GatewaySessionTurnPatchOutput extends GatewaySessionOutputBase {
    type: "session.turn.patch";
    turnId: string | null;
    messageId: string | null;
    anchorUserMessageId: string | null;
    seq: number;
    baseSeq: number;
    ops: GatewaySessionPatchOperation[];
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
export type GatewaySessionOutput = GatewaySessionTurnPatchOutput | GatewaySessionTurnErrorOutput | GatewaySessionMessagePersistedOutput;
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
