import { sql } from "drizzle-orm";
import { appViewStatsHourly } from "@cohub/db";
import {
  APP_VIEW_STATS_ACTIVE_REDIS_KEY,
  APP_VIEW_STATS_FLUSH_JOB,
  APP_VIEW_STATS_FLUSH_LOCK_REDIS_KEY,
  APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY,
  APP_VIEW_STATS_PENDING_REDIS_KEY_PREFIX,
} from "@cohub/protocol";
import { createLogger } from "@cohub/infra/logging";
import { db } from "../../../db.js";
import { redisCommandClient } from "../../../redis.js";
import { registerSystemJob } from "../../registry.js";
import { chunkStatsRows, flushBufferedStats } from "../buffered-stats-flush.js";
import { parseAppViewStatsBatch } from "./batch.js";

const logger = createLogger({ serviceName: "cohub-worker" });
const UPSERT_CHUNK_SIZE = 500;

async function persistPendingBatch(key: string) {
  const parsed = parseAppViewStatsBatch(await redisCommandClient.hgetall(key));
  if (parsed.rows.length > 0) {
    await db.transaction(async (tx) => {
      for (const rows of chunkStatsRows(parsed.rows, UPSERT_CHUNK_SIZE)) {
        await tx.insert(appViewStatsHourly).values(rows).onConflictDoUpdate({
          target: [
            appViewStatsHourly.appId,
            appViewStatsHourly.appVersionId,
            appViewStatsHourly.bucketStartAt,
            appViewStatsHourly.source,
          ],
          set: {
            viewCount: sql`${appViewStatsHourly.viewCount} + excluded.view_count`,
            updatedAt: rows[0]?.updatedAt ?? new Date(),
          },
        });
      }
    });
  }
  await redisCommandClient.multi()
    .del(key)
    .srem(APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY, key)
    .exec();
  return { rows: parsed.rows.length, invalid: parsed.invalid };
}

registerSystemJob(APP_VIEW_STATS_FLUSH_JOB, async () => {
  const result = await flushBufferedStats({
    activeKey: APP_VIEW_STATS_ACTIVE_REDIS_KEY,
    pendingKeyPrefix: APP_VIEW_STATS_PENDING_REDIS_KEY_PREFIX,
    pendingIndexKey: APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY,
    lockKey: APP_VIEW_STATS_FLUSH_LOCK_REDIS_KEY,
    persist: persistPendingBatch,
  });
  if (result.rows > 0 || result.invalid > 0) {
    logger.info("[AppViewStats] flushed buffered views", {
      batches: result.batches,
      rows: result.rows,
      invalid: result.invalid,
    });
  }
  return result;
});
