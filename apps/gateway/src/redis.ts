import { Redis } from "ioredis";
import type { RuntimeChannelConfig } from "@cohub/protocol";

export type RedisStreamEntry = [string, string[]];

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
console.log(`[Redis] Connecting to Redis: ${redisUrl.slice(0, 30)}...`);

/**
 * Shared command client for short-lived, non-blocking Redis commands only.
 *
 * Safe examples:
 * - ZADD / ZREM
 * - HGETALL / HSET
 * - XADD
 *
 * Do NOT use this client for blocking commands such as:
 * - XREAD BLOCK
 * - SUBSCRIBE / PSUBSCRIBE
 */
export const redisCommandClient = new Redis(redisUrl);

redisCommandClient.on("connect", () => {
  console.log("[Redis] Command client connected successfully");
});

redisCommandClient.on("error", (err) => {
  console.error("[Redis] Command client error:", err);
});

redisCommandClient.on("close", () => {
  console.warn("[Redis] Command client closed");
});

redisCommandClient.on("reconnecting", () => {
  console.log("[Redis] Command client reconnecting...");
});

// Stream 配置
export const GATEWAY_INBOUND_STREAM = "stream:gateway:inbound";
export const GATEWAY_OUTBOUND_STREAM = "stream:gateway:outbound";
export const GATEWAY_LOGS_STREAM = "stream:gateway:logs";
export const STREAM_MAXLEN = 10000;
export const STREAM_APPROX = "~";

export const xaddWithMaxlen = async (
  client: Redis,
  streamKey: string,
  ...args: (string | number)[]
) => client.xadd(streamKey, "MAXLEN", STREAM_APPROX, STREAM_MAXLEN, ...args);

const getRuntimeChannelConfigKey = (runtimeChannelId: string) => `gateway:runtime_channel_config:${runtimeChannelId}`;
const getTurnMessageRefKey = (runtimeChannelId: string, turnAnchorMessageId: string) =>
  `gateway:turn_message_ref:${runtimeChannelId}:${turnAnchorMessageId}`;
const runtimeChannelConfigCache = new Map<string, { expiresAt: number; value: RuntimeChannelConfig | null }>();
const RUNTIME_CHANNEL_CONFIG_TTL_MS = 3000;
const TURN_MESSAGE_REF_TTL_SECONDS = 60 * 30;

export const getRuntimeChannelConfig = async <TConfig extends RuntimeChannelConfig = RuntimeChannelConfig>(
  runtimeChannelId: string,
): Promise<TConfig | null> => {
  const now = Date.now();
  const cached = runtimeChannelConfigCache.get(runtimeChannelId);
  if (cached && cached.expiresAt > now) {
    return (cached.value as TConfig | null) ?? null;
  }

  const raw = await redisCommandClient.get(getRuntimeChannelConfigKey(runtimeChannelId));
  if (!raw) {
    runtimeChannelConfigCache.set(runtimeChannelId, { expiresAt: now + RUNTIME_CHANNEL_CONFIG_TTL_MS, value: null });
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as TConfig;
    runtimeChannelConfigCache.set(runtimeChannelId, {
      expiresAt: now + RUNTIME_CHANNEL_CONFIG_TTL_MS,
      value: parsed,
    });
    return parsed;
  } catch (error) {
    console.error(`[Redis] Failed to parse runtime channel config for ${runtimeChannelId}:`, error);
    runtimeChannelConfigCache.set(runtimeChannelId, { expiresAt: now + 1000, value: null });
    return null;
  }
};

export const getTurnMessageExternalRef = async (runtimeChannelId: string, turnAnchorMessageId: string) => {
  const value = await redisCommandClient.get(getTurnMessageRefKey(runtimeChannelId, turnAnchorMessageId));
  return value?.trim() || null;
};

export const setTurnMessageExternalRef = async (
  runtimeChannelId: string,
  turnAnchorMessageId: string,
  externalMessageId: string,
) => {
  await redisCommandClient.set(
    getTurnMessageRefKey(runtimeChannelId, turnAnchorMessageId),
    externalMessageId,
    "EX",
    TURN_MESSAGE_REF_TTL_SECONDS,
  );
};

/**
 * Creates a dedicated Redis connection for long-lived blocking consumers.
 */
export const createBlockingRedisClient = () => {
  const client = redisCommandClient.duplicate();

  client.on("connect", () => {
    console.log("[Redis] Blocking client connected successfully");
  });

  client.on("error", (err) => {
    console.error("[Redis] Blocking client error:", err);
  });

  client.on("close", () => {
    console.warn("[Redis] Blocking client closed");
  });

  client.on("reconnecting", () => {
    console.log("[Redis] Blocking client reconnecting...");
  });

  return client;
};
