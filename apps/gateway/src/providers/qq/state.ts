import { redisCommandClient } from "../../redis.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24;
const REPLY_TTL_SECONDS = 60 * 60;
const STATUS_TTL_SECONDS = 60 * 60 * 24 * 30;
const STREAM_TTL_SECONDS = 60 * 60;
const REF_INDEX_TTL_SECONDS = 60 * 60 * 24 * 7;

export type QQSessionState = {
  sessionId: string;
  lastSeq: number | null;
  updatedAt: number;
};

export type QQStatusField = "lastReadyAt" | "lastInboundAt" | "lastOutboundAt" | "lastErrorAt" | "lastError";

export type QQStreamState = {
  streamMsgId?: string;
  msgSeq: number;
  index: number;
  lastText: string;
};

export type QQRefIndexEntry = {
  content: string;
  senderId: string;
  senderName?: string;
  timestamp: number;
  isBot?: boolean;
  attachments?: Array<{ type: string; filename?: string; contentType?: string; url?: string }>;
};

const sessionKey = (channelId: string) => `gateway:qq:${channelId}:session`;
const replyKey = (channelId: string, messageId: string) => `gateway:qq:${channelId}:reply:${messageId}`;
const statusKey = (channelId: string) => `gateway:qq:${channelId}:status`;
const streamKey = (channelId: string, turnAnchorMessageId: string) => `gateway:qq:${channelId}:stream:${turnAnchorMessageId}`;
const refIndexKey = (channelId: string, refIdx: string) => `gateway:qq:${channelId}:ref:${refIdx}`;

export async function getQQSessionState(channelId: string): Promise<QQSessionState | null> {
  const raw = await redisCommandClient.get(sessionKey(channelId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QQSessionState>;
    if (!parsed.sessionId) return null;
    return {
      sessionId: parsed.sessionId,
      lastSeq: typeof parsed.lastSeq === "number" ? parsed.lastSeq : null,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function setQQSessionState(channelId: string, state: QQSessionState) {
  await redisCommandClient.set(sessionKey(channelId), JSON.stringify(state), "EX", SESSION_TTL_SECONDS);
}

export async function clearQQSessionState(channelId: string) {
  await redisCommandClient.del(sessionKey(channelId));
}

export async function reserveQQPassiveReply(channelId: string, messageId: string, limit: number) {
  const key = replyKey(channelId, messageId);
  const count = await redisCommandClient.incr(key);
  if (count === 1) await redisCommandClient.expire(key, REPLY_TTL_SECONDS);
  if (count <= limit) return true;
  return false;
}

export async function getQQStreamState(channelId: string, turnAnchorMessageId: string): Promise<QQStreamState | null> {
  const raw = await redisCommandClient.get(streamKey(channelId, turnAnchorMessageId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QQStreamState>;
    if (typeof parsed.msgSeq !== "number" || typeof parsed.index !== "number") return null;
    return {
      streamMsgId: typeof parsed.streamMsgId === "string" ? parsed.streamMsgId : undefined,
      msgSeq: parsed.msgSeq,
      index: parsed.index,
      lastText: typeof parsed.lastText === "string" ? parsed.lastText : "",
    };
  } catch {
    return null;
  }
}

export async function setQQStreamState(channelId: string, turnAnchorMessageId: string, state: QQStreamState) {
  await redisCommandClient.set(streamKey(channelId, turnAnchorMessageId), JSON.stringify(state), "EX", STREAM_TTL_SECONDS);
}

export async function clearQQStreamState(channelId: string, turnAnchorMessageId: string) {
  await redisCommandClient.del(streamKey(channelId, turnAnchorMessageId));
}

export async function setQQRefIndex(channelId: string, refIdx: string, entry: QQRefIndexEntry) {
  if (!refIdx.trim()) return;
  await redisCommandClient.set(refIndexKey(channelId, refIdx), JSON.stringify(entry), "EX", REF_INDEX_TTL_SECONDS);
}

export async function getQQRefIndex(channelId: string, refIdx: string): Promise<QQRefIndexEntry | null> {
  const raw = await redisCommandClient.get(refIndexKey(channelId, refIdx));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QQRefIndexEntry;
  } catch {
    return null;
  }
}

export async function updateQQStatus(channelId: string, fields: Partial<Record<QQStatusField, string | number>>) {
  const entries = Object.entries(fields)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null)
    .flatMap(([key, value]) => [key, String(value)]);
  if (entries.length === 0) return;
  await redisCommandClient.multi().hset(statusKey(channelId), ...entries).expire(statusKey(channelId), STATUS_TTL_SECONDS).exec();
}
