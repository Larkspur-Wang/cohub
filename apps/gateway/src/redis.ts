import { Redis } from "ioredis";

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
