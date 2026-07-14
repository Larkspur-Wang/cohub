/**
 * Whitelist of message-meta keys that are safe/necessary to broadcast on
 * `session.message.persisted` realtime events.
 *
 * `messageOrdinal` MUST stay in this list: the web client dedupes intermediate
 * messages by `ordinal:N` (see packages/sdk session-generation-stream
 * `getIntermediateMessageKey`). The REST stream-snapshot path also keys by
 * ordinal. If persisted realtime events drop the ordinal, the same logical
 * message lands under two incompatible dedupe keys (`ordinal:N` from snapshot
 * recovery vs `id:<uuid>` from the persisted event), producing duplicate
 * entries that crash Svelte's `{#each ... (id)}` in ProcessCard with
 * `each_key_duplicate` — the streaming UI freezes and only recovers once the
 * turn finalizes and reloads from the single-source messages.json.
 */
export const REALTIME_MESSAGE_META_KEYS = [
  "messageKind",
  "clientMessageId",
  "anchorUserMessageId",
  "userId",
  "contentDetail",
  "contentPlaceholder",
  "historySummary",
  "turnId",
  "messageId",
  "messageOrdinal",
] as const;

export const pickRealtimeMessageMeta = (
  meta: Record<string, unknown> | null | undefined,
) => {
  if (!meta) return null;
  const picked: Record<string, unknown> = {};
  for (const key of REALTIME_MESSAGE_META_KEYS) {
    if (meta[key] !== undefined) picked[key] = meta[key];
  }
  return Object.keys(picked).length > 0 ? picked : null;
};
