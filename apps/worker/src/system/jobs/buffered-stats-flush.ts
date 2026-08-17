import { randomUUID } from "node:crypto";
import { redisCommandClient } from "../../redis.js";

const LOCK_TTL_MS = 2 * 60_000;
const CUT_ACTIVE_HASH_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end
redis.call("SADD", KEYS[3], KEYS[2])
redis.call("RENAME", KEYS[1], KEYS[2])
return 1
`;
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export function chunkStatsRows<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

type BufferedStatsFlushConfig = {
  activeKey: string;
  pendingKeyPrefix: string;
  pendingIndexKey: string;
  lockKey: string;
  persist: (key: string) => Promise<{ rows: number; invalid: number }>;
};

export async function flushBufferedStats(config: BufferedStatsFlushConfig) {
  const lockToken = randomUUID();
  const acquired = await redisCommandClient.set(
    config.lockKey,
    lockToken,
    "PX",
    LOCK_TTL_MS,
    "NX",
  );
  if (acquired !== "OK") return { skipped: true, batches: 0, rows: 0, invalid: 0 };

  try {
    const pendingKey = `${config.pendingKeyPrefix}${Date.now()}-${randomUUID()}`;
    await redisCommandClient.eval(
      CUT_ACTIVE_HASH_SCRIPT,
      3,
      config.activeKey,
      pendingKey,
      config.pendingIndexKey,
    );
    const pendingKeys = await redisCommandClient.smembers(config.pendingIndexKey);
    let rows = 0;
    let invalid = 0;
    for (const key of pendingKeys) {
      const result = await config.persist(key);
      rows += result.rows;
      invalid += result.invalid;
    }
    return { skipped: false, batches: pendingKeys.length, rows, invalid };
  } finally {
    await redisCommandClient.eval(
      RELEASE_LOCK_SCRIPT,
      1,
      config.lockKey,
      lockToken,
    ).catch(() => undefined);
  }
}
