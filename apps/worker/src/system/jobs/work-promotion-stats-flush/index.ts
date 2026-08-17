import { sql } from "drizzle-orm";
import { workPromotionStatsHourly } from "@cohub/db";
import {
  WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  WORK_PROMOTION_STATS_FLUSH_JOB,
  WORK_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY,
  WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
  WORK_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX,
} from "@cohub/protocol";
import { createLogger } from "@cohub/infra/logging";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { chunkStatsRows, flushBufferedStats } from "../buffered-stats-flush.js";
import { parseWorkPromotionStatsBatch } from "./batch.js";

const logger = createLogger({ serviceName: "cohub-worker" });
const UPSERT_CHUNK_SIZE = 500;

async function persistPendingBatch(key: string) {
  const parsed = parseWorkPromotionStatsBatch(await redisCommandClient.hgetall(key));
  if (parsed.rows.length > 0) {
    await db.transaction(async (tx) => {
      for (const rows of chunkStatsRows(parsed.rows, UPSERT_CHUNK_SIZE)) {
        await tx.insert(workPromotionStatsHourly).values(rows).onConflictDoUpdate({
          target: [
            workPromotionStatsHourly.promotionId,
            workPromotionStatsHourly.workVersionId,
            workPromotionStatsHourly.bucketStartAt,
            workPromotionStatsHourly.eventKey,
          ],
          set: {
            eventCount: sql`${workPromotionStatsHourly.eventCount} + excluded.event_count`,
            updatedAt: rows[0]?.updatedAt ?? new Date(),
          },
        });
      }
    });
  }
  await redisCommandClient.multi()
    .del(key)
    .srem(WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY, key)
    .exec();
  return { rows: parsed.rows.length, invalid: parsed.invalid };
}

registerSystemJob(WORK_PROMOTION_STATS_FLUSH_JOB, async () => {
  const result = await flushBufferedStats({
    activeKey: WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
    pendingKeyPrefix: WORK_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX,
    pendingIndexKey: WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY,
    lockKey: WORK_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY,
    persist: persistPendingBatch,
  });
  if (result.rows > 0 || result.invalid > 0) {
    logger.info("[WorkPromotionStats] flushed buffered events", {
      batches: result.batches,
      rows: result.rows,
      invalid: result.invalid,
    });
  }
  return result;
});
