import type { ContentBlock } from "@cohub/protocol/core";

export type SnapshotIntermediateMessage = {
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
  id?: string | null;
};

export const resolveSnapshotStreamMessageId = (input: {
  sessionId: string;
  turnId?: string | null;
  messageOrdinal: number;
  anchorUserMessageId?: string | null;
}) => {
  const turnId = input.turnId?.trim();
  if (turnId) return `turn:${turnId}:assistant:${input.messageOrdinal}`;
  return `session:${input.sessionId}:assistant:${input.messageOrdinal}:${input.anchorUserMessageId ?? "unknown"}`;
};

export const getSnapshotMessageKey = (message: SnapshotIntermediateMessage) => {
  if (message.messageOrdinal != null) return `ordinal:${message.messageOrdinal}`;
  if (message.messageId) return `message:${message.messageId}`;
  if (message.id) return `id:${message.id}`;
  try {
    return `content:${JSON.stringify(message.content)}`;
  } catch {
    return null;
  }
};

export const mergeSnapshotMessage = <T extends SnapshotIntermediateMessage>(
  snapshotMessage: T,
  persistedMessage: T,
): T => ({
  ...snapshotMessage,
  ...persistedMessage,
  messageId: snapshotMessage.messageId ?? persistedMessage.messageId,
  messageOrdinal: snapshotMessage.messageOrdinal ?? persistedMessage.messageOrdinal,
  content: persistedMessage.content,
});

export const mergeSessionStreamSnapshotIntermediates = <T extends SnapshotIntermediateMessage>(
  snapshotMessages: T[],
  persistedMessages: T[],
): T[] => {
  if (persistedMessages.length === 0) return compactSnapshotIntermediates(snapshotMessages);

  const persistedByKey = new Map(
    persistedMessages
      .map((message) => [getSnapshotMessageKey(message), message] as const)
      .filter((entry): entry is [string, T] => Boolean(entry[0])),
  );
  const usedPersisted = new Set<T>();
  const merged = snapshotMessages.map((message, index) => {
    const key = getSnapshotMessageKey(message);
    const persistedMessage = (key ? persistedByKey.get(key) : undefined) ?? persistedMessages[index];
    if (!persistedMessage) return message;
    usedPersisted.add(persistedMessage);
    return mergeSnapshotMessage(message, persistedMessage);
  });
  for (const message of persistedMessages) {
    if (!usedPersisted.has(message)) merged.push(message);
  }
  return compactSnapshotIntermediates(merged);
};

export const compactSnapshotIntermediates = <T extends SnapshotIntermediateMessage>(messages: T[]): T[] => {
  const merged: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const message of messages) {
    const key = getSnapshotMessageKey(message);
    if (!key) {
      merged.push(message);
      continue;
    }
    const index = indexByKey.get(key);
    if (index == null) {
      indexByKey.set(key, merged.length);
      merged.push(message);
      continue;
    }
    const existing = merged[index];
    if (!existing) {
      merged[index] = message;
      continue;
    }
    merged[index] = mergeSnapshotMessage(existing, message);
  }
  return merged;
};
