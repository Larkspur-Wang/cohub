export type RealtimePatchIdentityInput = {
  turnId?: unknown;
  messageId?: unknown;
  sourceMessageId?: unknown;
  anchorUserMessageId?: unknown;
  messageOrdinal?: unknown;
  sessionId?: unknown;
};

const getNonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

export const getSessionTurnPatchStreamKey = (
  input: RealtimePatchIdentityInput,
  options: { includeSessionFallback?: boolean } = {},
) => {
  const turnId = getNonEmptyString(input.turnId);
  const messageKey =
    getNonEmptyString(input.messageId) ??
    getNonEmptyString(input.sourceMessageId) ??
    getNonEmptyString(input.anchorUserMessageId) ??
    (typeof input.messageOrdinal === "number" && Number.isFinite(input.messageOrdinal)
      ? `ordinal:${input.messageOrdinal}`
      : null);

  if (turnId && messageKey) return `${turnId}:${messageKey}`;
  const streamKey = messageKey ?? turnId;
  if (streamKey) return streamKey;
  return options.includeSessionFallback ? getNonEmptyString(input.sessionId) : null;
};

export * from "./stream.js";
export * from "./websocket.js";
