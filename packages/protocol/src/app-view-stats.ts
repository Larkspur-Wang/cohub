import { isUuidLike } from "./identifiers.js";

const APP_VIEW_STATS_REDIS_PREFIX = "cohub:{app-view-stats-v1}";
export const APP_VIEW_STATS_ACTIVE_REDIS_KEY = `${APP_VIEW_STATS_REDIS_PREFIX}:active`;
export const APP_VIEW_STATS_PENDING_REDIS_KEY_PREFIX = `${APP_VIEW_STATS_REDIS_PREFIX}:pending:`;
export const APP_VIEW_STATS_PENDING_INDEX_REDIS_KEY = `${APP_VIEW_STATS_REDIS_PREFIX}:pending-index`;
export const APP_VIEW_STATS_FLUSH_LOCK_REDIS_KEY = `${APP_VIEW_STATS_REDIS_PREFIX}:flush-lock`;
export const APP_VIEW_STATS_FLUSH_JOB = "app.view_stats.flush";
export const APP_VIEW_STATS_FLUSH_SCHEDULER_ID = "app-view-stats-flush";
export const APP_VIEW_STATS_FLUSH_INTERVAL_MS = 30_000;

export type AppViewStatsSource = "web" | "cli" | "api";

export type AppViewStatsRedisField = {
  appId: string;
  appVersionId: string;
  bucketStartAtMs: number;
  source: AppViewStatsSource;
};

const APP_VIEW_STATS_SOURCES = new Set<AppViewStatsSource>(["web", "cli", "api"]);

export function encodeAppViewStatsRedisField(input: AppViewStatsRedisField): string {
  return JSON.stringify([
    input.appId,
    input.appVersionId,
    input.bucketStartAtMs,
    input.source,
  ]);
}

export function decodeAppViewStatsRedisField(value: string): AppViewStatsRedisField | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [appId, appVersionId, bucketStartAtMs, source] = parsed;
    if (!isUuidLike(appId)) return null;
    if (!isUuidLike(appVersionId)) return null;
    if (
      !Number.isSafeInteger(bucketStartAtMs)
      || bucketStartAtMs < 0
      || Number.isNaN(new Date(bucketStartAtMs).getTime())
    ) return null;
    if (typeof source !== "string" || !APP_VIEW_STATS_SOURCES.has(source as AppViewStatsSource)) return null;
    return {
      appId,
      appVersionId,
      bucketStartAtMs,
      source: source as AppViewStatsSource,
    };
  } catch {
    return null;
  }
}
