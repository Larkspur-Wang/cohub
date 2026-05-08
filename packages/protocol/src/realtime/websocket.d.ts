import { z } from "zod";
import type { ContentBlock } from "../core/content.js";
import type { MessageRecord } from "../model/session.js";
import type { SpaceFsChangedPayload } from "../fs/index.js";
export declare const WS_COMPACT_STREAM_CAPABILITY = "session.compact_stream.v1";
export declare const contentBlockSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    text: z.ZodString;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"thinking">;
    thinking: z.ZodString;
    signature: z.ZodOptional<z.ZodString>;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"image">;
    source: z.ZodUnion<readonly [z.ZodObject<{
        type: z.ZodLiteral<"url">;
        url: z.ZodString;
    }, z.core.$strip>, z.ZodObject<{
        type: z.ZodLiteral<"base64">;
        media_type: z.ZodString;
        data: z.ZodString;
    }, z.core.$strip>]>;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"tool_use">;
    id: z.ZodString;
    name: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"tool_result">;
    tool_use_id: z.ZodString;
    content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnknown>]>;
    is_error: z.ZodOptional<z.ZodBoolean>;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"system_note">;
    note_type: z.ZodEnum<{
        session_created: "session_created";
        forked: "forked";
        compacted: "compacted";
        info: "info";
    }>;
    text: z.ZodString;
    _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>], "type">;
export declare const wsClientEventSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"auth">;
    requestId: z.ZodOptional<z.ZodString>;
    payload: z.ZodObject<{
        token: z.ZodString;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"session.message.create">;
    requestId: z.ZodOptional<z.ZodString>;
    payload: z.ZodObject<{
        spaceId: z.ZodString;
        sessionId: z.ZodString;
        clientMessageId: z.ZodOptional<z.ZodString>;
        content: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            text: z.ZodString;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"thinking">;
            thinking: z.ZodString;
            signature: z.ZodOptional<z.ZodString>;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            source: z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"url">;
                url: z.ZodString;
            }, z.core.$strip>, z.ZodObject<{
                type: z.ZodLiteral<"base64">;
                media_type: z.ZodString;
                data: z.ZodString;
            }, z.core.$strip>]>;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"tool_use">;
            id: z.ZodString;
            name: z.ZodString;
            input: z.ZodRecord<z.ZodString, z.ZodUnknown>;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"tool_result">;
            tool_use_id: z.ZodString;
            content: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodUnknown>]>;
            is_error: z.ZodOptional<z.ZodBoolean>;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>, z.ZodObject<{
            type: z.ZodLiteral<"system_note">;
            note_type: z.ZodEnum<{
                session_created: "session_created";
                forked: "forked";
                compacted: "compacted";
                info: "info";
            }>;
            text: z.ZodString;
            _meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        }, z.core.$strip>], "type">>;
        model: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"ping">;
    requestId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"ack">;
    requestId: z.ZodOptional<z.ZodString>;
    payload: z.ZodOptional<z.ZodObject<{
        eventId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>], "type">;
export declare const realtimeEnvelopeSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodNumber;
    domain: z.ZodEnum<{
        system: "system";
        session: "session";
        space: "space";
    }>;
    type: z.ZodString;
    requestId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sessionId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const channelEnvelopeSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodNumber;
    domain: z.ZodEnum<{
        system: "system";
        session: "session";
        space: "space";
    }>;
    type: z.ZodString;
    requestId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    spaceId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sessionId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const realtimeCompactFrameSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    t: z.ZodLiteral<"d">;
    sid: z.ZodString;
    s: z.ZodNumber;
    b: z.ZodNumber;
    v: z.ZodUnknown;
}, z.core.$strip>, z.ZodObject<{
    t: z.ZodLiteral<"p">;
    sid: z.ZodString;
    s: z.ZodNumber;
    b: z.ZodNumber;
    o: z.ZodEnum<{
        append: "append";
        replace: "replace";
        add: "add";
        merge: "merge";
        remove: "remove";
    }>;
    p: z.ZodString;
    v: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>], "t">;
export type WsClientEvent = {
    type: "auth";
    requestId?: string;
    payload: {
        token: string;
        capabilities?: string[];
    };
} | {
    type: "session.message.create";
    requestId?: string;
    payload: {
        spaceId: string;
        sessionId: string;
        clientMessageId?: string;
        content: ContentBlock[];
        model?: string;
        provider?: string;
    };
} | {
    type: "ping";
    requestId?: string;
    payload?: Record<string, unknown>;
} | {
    type: "ack";
    requestId?: string;
    payload?: {
        eventId?: string;
    };
};
export type RealtimeEnvelope = z.output<typeof realtimeEnvelopeSchema>;
export type ChannelEnvelope = RealtimeEnvelope;
export type RealtimeCompactFrame = z.output<typeof realtimeCompactFrameSchema>;
export type RealtimeEnvelopeBase = RealtimeEnvelope;
export type RealtimeDomain = RealtimeEnvelopeBase["domain"];
export type SystemReadyEvent = {
    id: string;
    timestamp: number;
    domain: "system";
    type: "system.ready";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: {
        connectionId: string;
    };
};
export type SystemAuthOkEvent = {
    id: string;
    timestamp: number;
    domain: "system";
    type: "system.auth.ok";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: {
        connectionId: string;
        user: Record<string, unknown>;
    };
};
export type SystemRequestErrorEvent = {
    id: string;
    timestamp: number;
    domain: "system";
    type: "system.request.error";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: {
        code: string;
        message: string;
    };
};
export type SystemPongEvent = {
    id: string;
    timestamp: number;
    domain: "system";
    type: "system.pong";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: Record<string, never>;
};
export type SystemAckOkEvent = {
    id: string;
    timestamp: number;
    domain: "system";
    type: "system.ack.ok";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: Record<string, never>;
};
export type SessionRequestAcceptedEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.request.accepted";
    requestId?: string | null;
    spaceId: string;
    sessionId: string;
    payload: {
        clientMessageId?: string | null;
    };
};
export type SessionRequestErrorEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.request.error";
    requestId?: string | null;
    spaceId?: string | null;
    sessionId?: string | null;
    payload: {
        code: string;
        message: string;
        clientMessageId?: string | null;
    };
};
export type SessionTurnProgressEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.turn.progress";
    requestId?: string | null;
    spaceId: string;
    sessionId: string;
    payload: {
        anchorUserMessageId: string | null;
        content: ContentBlock[];
    };
};
export type RealtimePatchOperation = {
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
export type RealtimePatchIdentityInput = {
    turnId?: unknown;
    messageId?: unknown;
    sourceMessageId?: unknown;
    anchorUserMessageId?: unknown;
    messageOrdinal?: unknown;
    sessionId?: unknown;
};
export declare const getSessionTurnPatchStreamKey: (input: RealtimePatchIdentityInput, options?: {
    includeSessionFallback?: boolean;
}) => string | null;
export type SessionTurnPatchEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.turn.patch";
    requestId?: string | null;
    spaceId: string;
    sessionId: string;
    payload: {
        turnId: string | null;
        messageId: string | null;
        messageOrdinal?: number | null;
        sourceMessageId?: string | null;
        anchorUserMessageId: string | null;
        seq: number;
        baseSeq: number;
        ops: RealtimePatchOperation[];
    };
};
export type SessionTurnErrorEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.turn.error";
    requestId?: string | null;
    spaceId: string;
    sessionId: string;
    payload: {
        anchorUserMessageId: string | null;
        error: string;
    };
};
export type RealtimeMessageRecord = Pick<MessageRecord, "id" | "sessionId" | "role" | "content" | "text" | "sequence" | "provider" | "model" | "stopReason" | "errorMessage" | "usage" | "meta" | "createdAt">;
export type SessionMessagePersistedEvent = {
    id: string;
    timestamp: number;
    domain: "session";
    type: "session.message.persisted";
    requestId?: string | null;
    spaceId: string;
    sessionId: string;
    payload: {
        message: RealtimeMessageRecord;
    };
};
export type SpaceFsChangedEvent = {
    id: string;
    timestamp: number;
    domain: "space";
    type: "space.fs.changed";
    requestId?: string | null;
    spaceId: string;
    sessionId?: string | null;
    payload: SpaceFsChangedPayload;
};
export type RealtimeServerEvent = SystemReadyEvent | SystemAuthOkEvent | SystemRequestErrorEvent | SystemPongEvent | SystemAckOkEvent | SessionRequestAcceptedEvent | SessionRequestErrorEvent | SessionTurnProgressEvent | SessionTurnPatchEvent | SessionTurnErrorEvent | SessionMessagePersistedEvent | SpaceFsChangedEvent;
export type WsServerEnvelope = RealtimeEnvelope;
export type ChannelServerEnvelope = ChannelEnvelope;
