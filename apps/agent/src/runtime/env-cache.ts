import { Redis } from "ioredis";
import { SYSTEM_ENV_KEY_SET, SPACE_ENV_REDIS_KEY } from "@cohub/protocol/sandbox";
import { env } from "../env.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-agent" });
let redisClient: Redis | null = null;

/** Get a Redis client (lazy init, reused across calls; ioredis handles auto-reconnect) */
function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, { disableClientInfo: true });
    redisClient.on("error", (err) => {
      logger.warn(`[EnvCache] Redis error for space env: ${err.message}`);
    });
  }
  return redisClient;
}

/** Parse and sanitize the Redis value written by the API. */
export function parseUserEnv(raw: string | null): Record<string, string> {
  if (!raw) return {};

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("space env cache must be an array");

  const userEnv: Record<string, string> = {};
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || typeof value !== "string") continue;
    if (!SYSTEM_ENV_KEY_SET.has(name) && name.length > 0) userEnv[name] = value;
  }
  return userEnv;
}

/**
 * Load one immutable space env snapshot for a process execution scope. Nothing
 * is retained across scopes, so later work observes the latest Redis value.
 */
export async function loadSpaceEnvSnapshot(spaceId: string): Promise<Record<string, string>> {
  try {
    const raw = await getRedisClient().get(SPACE_ENV_REDIS_KEY(spaceId));
    return parseUserEnv(raw);
  } catch (err) {
    logger.warn(`[EnvCache] Failed to load env for ${spaceId}: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
