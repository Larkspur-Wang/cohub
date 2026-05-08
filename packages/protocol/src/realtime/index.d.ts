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
export * from "./stream.js";
export * from "./websocket.js";
