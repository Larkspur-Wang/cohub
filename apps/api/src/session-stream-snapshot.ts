import type { ContentBlock } from "@cohub/protocol/core";
import type { StoredIntermediateMessage } from "@cohub/protocol/model";
import { and, asc, eq, sql } from "drizzle-orm";
import { redisCommandClient } from "./redis.js";
import { db } from "./db/index.js";
import { sessionMessages } from "@cohub/db";

export const getSessionStreamSnapshotKey = (spaceId: string, sessionId: string) =>
  `session:stream:snapshot:${spaceId}:${sessionId}`;

export type SessionStreamSnapshotMessage = {
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
};

export type EnrichedSessionStreamSnapshotMessage = SessionStreamSnapshotMessage & Partial<StoredIntermediateMessage>;

export type SessionStreamSnapshot = {
  version: 2;
  spaceId: string;
  sessionId: string;
  turnId: string | null;
  anchorUserMessageId: string | null;
  seq: number;
  current: SessionStreamSnapshotMessage & { appendPath: string | null };
  intermediateMessages: EnrichedSessionStreamSnapshotMessage[];
  updatedAt: number;
};

const isSnapshotMessage = (value: unknown, current = false): value is SessionStreamSnapshot["current"] => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.content)) return false;
  if (record.messageId !== null && typeof record.messageId !== "string") return false;
  if (record.messageOrdinal !== null && typeof record.messageOrdinal !== "number") return false;
  if (current && record.appendPath !== null && typeof record.appendPath !== "string") return false;
  return true;
};

export const parseSessionStreamSnapshot = (raw: string | null): SessionStreamSnapshot | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SessionStreamSnapshot>;
    if (value.version !== 2) return null;
    if (!value.spaceId || !value.sessionId) return null;
    if (typeof value.seq !== "number" || value.seq <= 0) return null;
    if (!isSnapshotMessage(value.current, true)) return null;
    if (!Array.isArray(value.intermediateMessages) || !value.intermediateMessages.every((message) => isSnapshotMessage(message))) return null;
    return value as SessionStreamSnapshot;
  } catch {
    return null;
  }
};

const toIso = (value: Date | string | null | undefined) =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : new Date().toISOString();

const normalizeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const toSnapshotIntermediateMessage = (row: typeof sessionMessages.$inferSelect, messageOrdinal: number): EnrichedSessionStreamSnapshotMessage => ({
  messageId: row.id,
  messageOrdinal,
  id: row.id,
  sessionId: row.sessionId,
  role: row.role as "user" | "assistant" | "system",
  content: row.content as ContentBlock[],
  text: row.text ?? null,
  provider: row.provider ?? null,
  model: row.model ?? null,
  stopReason: row.stopReason ?? null,
  errorMessage: row.errorMessage ?? null,
  usage: row.usage as StoredIntermediateMessage["usage"],
  toolCallsObjectKey: null,
  meta: normalizeRecord(row.meta),
  createdAt: toIso(row.createdAt),
});

const listPersistedIntermediateMessages = async (input: { sessionId: string; turnId: string }) => {
  const rows = await db.select().from(sessionMessages).where(and(
    eq(sessionMessages.sessionId, input.sessionId),
    eq(sessionMessages.role, "assistant"),
    sql`${sessionMessages.meta}->>'turnId' = ${input.turnId}`,
    sql`coalesce(${sessionMessages.meta}->>'messageKind', '') not in ('assistant_final', 'assistant_error')`,
  )).orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));
  return rows.map(toSnapshotIntermediateMessage);
};

const enrichSessionStreamSnapshot = async (snapshot: SessionStreamSnapshot): Promise<SessionStreamSnapshot> => {
  if (!snapshot.turnId) return snapshot;
  const persisted = await listPersistedIntermediateMessages({ sessionId: snapshot.sessionId, turnId: snapshot.turnId }).catch(() => []);
  if (persisted.length === 0) return snapshot;

  const merged = snapshot.intermediateMessages.map((message, index) => {
    const persistedMessage = persisted[index];
    return persistedMessage
      ? {
          ...message,
          ...persistedMessage,
          messageId: message.messageId ?? persistedMessage.messageId,
          messageOrdinal: message.messageOrdinal ?? persistedMessage.messageOrdinal,
          content: persistedMessage.content,
        }
      : message;
  });
  if (persisted.length > merged.length) merged.push(...persisted.slice(merged.length));
  return { ...snapshot, intermediateMessages: merged };
};

export const getSessionStreamSnapshot = async (input: { spaceId: string; sessionId: string }) => {
  const snapshot = parseSessionStreamSnapshot(
    await redisCommandClient.get(getSessionStreamSnapshotKey(input.spaceId, input.sessionId)).catch(() => null),
  );
  if (!snapshot) return null;
  if (snapshot.spaceId !== input.spaceId || snapshot.sessionId !== input.sessionId) return null;
  return enrichSessionStreamSnapshot(snapshot);
};

export const clearSessionStreamSnapshot = async (input: { spaceId: string; sessionId: string }) => {
  await redisCommandClient.del(getSessionStreamSnapshotKey(input.spaceId, input.sessionId)).catch(() => undefined);
};
