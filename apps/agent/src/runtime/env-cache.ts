import { Redis } from "ioredis";
import { SYSTEM_ENV_KEY_SET, SPACE_ENV_REDIS_KEY } from "@cohub/agent-sandbox-protocol";
import { env } from "../env.js";

let cachedUserEnv: Record<string, string> = {};
let redisClient: Redis | null = null;

/** Get a Redis client (lazy init, reused across calls; ioredis handles auto-reconnect) */
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL);
    redisClient.on("error", (err) => {
      console.warn(`[EnvCache] Redis error for space env: ${err.message}`);
    });
  }
  return redisClient;
}

/**
 * Fetch space env from Redis cache (set by API on env changes).
 * Falls back to empty object if Redis is unavailable.
 */
export async function refreshUserEnv(spaceId: string): Promise<void> {
  try {
    const key = SPACE_ENV_REDIS_KEY(spaceId);
    const raw = await getRedisClient().get(key);
    if (raw) {
      const parsed: Array<{ name: string; value: string }> = JSON.parse(raw);
      cachedUserEnv = {};
      for (const entry of parsed) {
        // Double-safety: skip system keys even if somehow stored
        if (!SYSTEM_ENV_KEY_SET.has(entry.name) && entry.name.length > 0) {
          cachedUserEnv[entry.name] = entry.value;
        }
      }
    }
  } catch (err) {
    // Redis unavailable or bad data — keep using stale cache
    console.warn(`[EnvCache] Failed to refresh env for ${spaceId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Return a snapshot of the current user env for process injection */
export function getUserEnvForProcess(): Record<string, string> {
  return { ...cachedUserEnv };
}
