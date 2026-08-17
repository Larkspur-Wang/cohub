import { isUuidLike } from "./identifiers.js";

const PREFIX = "cohub:{work-promotion-stats-v1}";
export const WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY = `${PREFIX}:active`;
export const WORK_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX = `${PREFIX}:pending:`;
export const WORK_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY = `${PREFIX}:pending-index`;
export const WORK_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY = `${PREFIX}:flush-lock`;
export const WORK_PROMOTION_STATS_FLUSH_JOB = "work.promotion_stats.flush";
export const WORK_PROMOTION_STATS_FLUSH_SCHEDULER_ID = "work-promotion-stats-flush";
export const WORK_PROMOTION_STATS_FLUSH_INTERVAL_MS = 30_000;

export const WORK_PROMOTION_EVENT_KEYS = [
  "landing",
  "ready",
  "registration_completed",
  "paywall_viewed",
  "checkout_started",
] as const;
export type WorkPromotionEventKey = typeof WORK_PROMOTION_EVENT_KEYS[number];

export type WorkPromotionStatsRedisField = {
  promotionId: string;
  workVersionId: string;
  bucketStartAtMs: number;
  eventKey: WorkPromotionEventKey;
};

const EVENT_KEYS = new Set<string>(WORK_PROMOTION_EVENT_KEYS);

export function encodeWorkPromotionStatsRedisField(input: WorkPromotionStatsRedisField): string {
  return JSON.stringify([
    input.promotionId,
    input.workVersionId,
    input.bucketStartAtMs,
    input.eventKey,
  ]);
}

export function decodeWorkPromotionStatsRedisField(value: string): WorkPromotionStatsRedisField | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [promotionId, workVersionId, bucketStartAtMs, eventKey] = parsed;
    if (!isUuidLike(promotionId) || !isUuidLike(workVersionId)) return null;
    if (
      !Number.isSafeInteger(bucketStartAtMs)
      || bucketStartAtMs < 0
      || Number.isNaN(new Date(bucketStartAtMs).getTime())
    ) return null;
    if (typeof eventKey !== "string" || !EVENT_KEYS.has(eventKey)) return null;
    return {
      promotionId,
      workVersionId,
      bucketStartAtMs,
      eventKey: eventKey as WorkPromotionEventKey,
    };
  } catch {
    return null;
  }
}
