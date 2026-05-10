import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { redisCommandClient } from "./redis.js";

export const getSessionStreamSnapshotKey = (spaceId: string, sessionId: string) =>
  `session:stream:snapshot:${spaceId}:${sessionId}`;

export type SessionStreamSnapshotMessage = {
  messageId: string | null;
  messageOrdinal: number | null;
  content: ContentBlock[];
};

export type SessionStreamSnapshot = {
  version: 2;
  spaceId: string;
  sessionId: string;
  turnId: string | null;
  anchorUserMessageId: string | null;
  seq: number;
  current: SessionStreamSnapshotMessage & { appendPath: string | null };
  intermediateMessages: SessionStreamSnapshotMessage[];
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

export const getSessionStreamSnapshot = async (input: { spaceId: string; sessionId: string }) => {
  const snapshot = parseSessionStreamSnapshot(
    await redisCommandClient.get(getSessionStreamSnapshotKey(input.spaceId, input.sessionId)).catch(() => null),
  );
  if (!snapshot) return null;
  if (snapshot.spaceId !== input.spaceId || snapshot.sessionId !== input.sessionId) return null;
  return snapshot;
};

export const clearSessionStreamSnapshot = async (input: { spaceId: string; sessionId: string }) => {
  await redisCommandClient.del(getSessionStreamSnapshotKey(input.spaceId, input.sessionId)).catch(() => undefined);
};
