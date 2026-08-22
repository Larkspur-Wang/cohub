import { sql } from "drizzle-orm";
import { appPromotionStatsHourly } from "@cohub/db";
import {
  APP_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  APP_PROMOTION_STATS_FLUSH_JOB,
  APP_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY,
  APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
  APP_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX,
} from "@cohub/protocol";
import { createLogger } from "@cohub/infra/logging";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { chunkStatsRows, flushBufferedStats } from "../buffered-stats-flush.js";
import { parseAppPromotionStatsBatch } from "./batch.js";

const logger = createLogger({ serviceName: "cohub-worker" });
const UPSERT_CHUNK_SIZE = 500;

async function persistPendingBatch(key: string) {
  const parsed = parseAppPromotionStatsBatch(await redisCommandClient.hgetall(key));
  if (parsed.rows.length > 0) {
    await db.transaction(async (tx) => {
      for (const rows of chunkStatsRows(parsed.rows, UPSERT_CHUNK_SIZE)) {
        await tx.insert(appPromotionStatsHourly).values(rows).onConflictDoUpdate({
          target: [
            appPromotionStatsHourly.promotionId,
            appPromotionStatsHourly.appVersionId,
            appPromotionStatsHourly.bucketStartAt,
            appPromotionStatsHourly.eventKey,
          ],
          set: {
            eventCount: sql`${appPromotionStatsHourly.eventCount} + excluded.event_count`,
            updatedAt: rows[0]?.updatedAt ?? new Date(),
          },
        });
      }
    });
  }
  await redisCommandClient.multi()
    .del(key)
    .srem(APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY, key)
    .exec();
  return { rows: parsed.rows.length, invalid: parsed.invalid };
}

registerSystemJob(APP_PROMOTION_STATS_FLUSH_JOB, async () => {
  const result = await flushBufferedStats({
    activeKey: APP_PROMOTION_STATS_ACTIVE_REDIS_KEY,
    pendingKeyPrefix: APP_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX,
    pendingIndexKey: APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
    lockKey: APP_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY,
    persist: persistPendingBatch,
  });
  if (result.rows > 0 || result.invalid > 0) {
    logger.info("[AppPromotionStats] flushed buffered events", {
      batches: result.batches,
      rows: result.rows,
      invalid: result.invalid,
    });
  }
  return result;
});
