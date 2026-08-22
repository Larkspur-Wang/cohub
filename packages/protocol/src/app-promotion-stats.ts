import { isUuidLike } from "./identifiers.js";

const PREFIX = "cohub:{app-promotion-stats-v1}";
export const APP_PROMOTION_STATS_ACTIVE_REDIS_KEY = `${PREFIX}:active`;
export const APP_PROMOTION_STATS_PENDING_REDIS_KEY_PREFIX = `${PREFIX}:pending:`;
export const APP_PROMOTION_STATS_PENDING_INDEX_REDIS_KEY = `${PREFIX}:pending-index`;
export const APP_PROMOTION_STATS_FLUSH_LOCK_REDIS_KEY = `${PREFIX}:flush-lock`;
export const APP_PROMOTION_STATS_FLUSH_JOB = "app.promotion_stats.flush";
export const APP_PROMOTION_STATS_FLUSH_SCHEDULER_ID = "app-promotion-stats-flush";
export const APP_PROMOTION_STATS_FLUSH_INTERVAL_MS = 30_000;

export const APP_PROMOTION_EVENT_KEYS = [
  "landing",
  "ready",
  "registration_completed",
  "paywall_viewed",
  "checkout_started",
] as const;
export type AppPromotionEventKey = typeof APP_PROMOTION_EVENT_KEYS[number];

export type AppPromotionStatsRedisField = {
  promotionId: string;
  appVersionId: string;
  bucketStartAtMs: number;
  eventKey: AppPromotionEventKey;
};

const EVENT_KEYS = new Set<string>(APP_PROMOTION_EVENT_KEYS);

export function encodeAppPromotionStatsRedisField(input: AppPromotionStatsRedisField): string {
  return JSON.stringify([
    input.promotionId,
    input.appVersionId,
    input.bucketStartAtMs,
    input.eventKey,
  ]);
}

export function decodeAppPromotionStatsRedisField(value: string): AppPromotionStatsRedisField | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [promotionId, appVersionId, bucketStartAtMs, eventKey] = parsed;
    if (!isUuidLike(promotionId) || !isUuidLike(appVersionId)) return null;
    if (
      !Number.isSafeInteger(bucketStartAtMs)
      || bucketStartAtMs < 0
      || Number.isNaN(new Date(bucketStartAtMs).getTime())
    ) return null;
    if (typeof eventKey !== "string" || !EVENT_KEYS.has(eventKey)) return null;
    return {
      promotionId,
      appVersionId,
      bucketStartAtMs,
      eventKey: eventKey as AppPromotionEventKey,
    };
  } catch {
    return null;
  }
}
