import { and, asc, eq, gte, sql } from "drizzle-orm";
import { appViewStatsHourly } from "@cohub/db";
import {
  encodeAppViewStatsRedisField,
  APP_VIEW_STATS_ACTIVE_REDIS_KEY,
  type AppViewStatsSource,
} from "@cohub/protocol";
import type { RequestSource } from "@cohub/protocol/provenance";
import { db } from "./db/index.js";

export type AppViewSource = AppViewStatsSource;

export type AppViewStatsResponse = {
  summary: {
    totalViews: number;
    views24h: number;
    views7d: number;
    views30d: number;
  };
  daily: Array<{ date: string; views: number }>;
  sources: Array<{ source: AppViewSource; views: number }>;
};

type AppViewStatsRow = {
  bucketStartAt: Date;
  source: string;
  viewCount: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATS_DAYS = 30;
const SOURCE_ORDER: AppViewSource[] = ["web", "cli", "api"];

const toCount = (value: unknown) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

export function toUtcHourBucket(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
}

function toUtcDayBucket(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function resolveAppViewSource(source: RequestSource | null | undefined, fallback: AppViewSource): AppViewSource {
  if (source?.via === "cli") return "cli";
  if (source?.via === "web") return "web";
  if (source?.via) return "api";
  return fallback;
}

type AppViewStatsRedisClient = {
  readonly status: string;
  hincrby(key: string, field: string, increment: number): Promise<number>;
};

let appViewStatsRedisPromise: Promise<AppViewStatsRedisClient> | null = null;
const resolveAppViewStatsRedis = (): Promise<AppViewStatsRedisClient> => {
  appViewStatsRedisPromise ??= import("./redis.js")
    .then((module) => module.redisBestEffortCommandClient);
  return appViewStatsRedisPromise;
};

export async function recordAppViewStatsHourly(input: {
  appId: string;
  appVersionId: string;
  source: AppViewSource;
  viewedAt?: Date;
  redis?: AppViewStatsRedisClient;
}): Promise<boolean> {
  const now = input.viewedAt ?? new Date();
  const bucketStartAt = toUtcHourBucket(now);
  const redis = input.redis ?? await resolveAppViewStatsRedis();
  if (redis.status !== "ready") return false;
  await redis.hincrby(APP_VIEW_STATS_ACTIVE_REDIS_KEY, encodeAppViewStatsRedisField({
    appId: input.appId,
    appVersionId: input.appVersionId,
    bucketStartAtMs: bucketStartAt.getTime(),
    source: input.source,
  }), 1);
  return true;
}

export function aggregateAppViewStats(input: {
  totalViews: unknown;
  rows: readonly AppViewStatsRow[];
  now: Date;
}): AppViewStatsResponse {
  const currentHourMs = toUtcHourBucket(input.now).getTime();
  const start24h = currentHourMs - 23 * HOUR_MS;
  const start7d = currentHourMs - 167 * HOUR_MS;
  const startDay = toUtcDayBucket(new Date(input.now.getTime() - (STATS_DAYS - 1) * DAY_MS));
  const dailyMap = new Map<string, number>();
  const sourceMap = new Map<AppViewSource, number>();
  for (let offset = 0; offset < STATS_DAYS; offset += 1) {
    dailyMap.set(dateKey(new Date(startDay.getTime() + offset * DAY_MS)), 0);
  }

  let views24h = 0;
  let views7d = 0;
  let views30d = 0;
  for (const row of input.rows) {
    const views = toCount(row.viewCount);
    const bucketMs = row.bucketStartAt.getTime();
    if (bucketMs >= start24h) views24h += views;
    if (bucketMs >= start7d) views7d += views;
    const day = dateKey(row.bucketStartAt);
    if (!dailyMap.has(day)) continue;
    views30d += views;
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + views);
    const source = SOURCE_ORDER.includes(row.source as AppViewSource)
      ? row.source as AppViewSource
      : "api";
    sourceMap.set(source, (sourceMap.get(source) ?? 0) + views);
  }

  return {
    summary: {
      totalViews: toCount(input.totalViews),
      views24h,
      views7d,
      views30d,
    },
    daily: Array.from(dailyMap, ([date, views]) => ({ date, views })),
    sources: SOURCE_ORDER
      .map((source) => ({ source, views: sourceMap.get(source) ?? 0 }))
      .filter((item) => item.views > 0),
  };
}

export async function getAppViewStats(appId: string): Promise<AppViewStatsResponse> {
  const now = new Date();
  const startDay = toUtcDayBucket(new Date(now.getTime() - (STATS_DAYS - 1) * DAY_MS));
  const [totalRows, recentRows] = await Promise.all([
    db
      .select({ totalViews: sql<string>`coalesce(sum(${appViewStatsHourly.viewCount}), 0)` })
      .from(appViewStatsHourly)
      .where(eq(appViewStatsHourly.appId, appId)),
    db
      .select({
        bucketStartAt: appViewStatsHourly.bucketStartAt,
        source: appViewStatsHourly.source,
        viewCount: appViewStatsHourly.viewCount,
      })
      .from(appViewStatsHourly)
      .where(and(
        eq(appViewStatsHourly.appId, appId),
        gte(appViewStatsHourly.bucketStartAt, startDay),
      ))
      .orderBy(asc(appViewStatsHourly.bucketStartAt)),
  ]);
  return aggregateAppViewStats({
    totalViews: totalRows[0]?.totalViews ?? 0,
    rows: recentRows,
    now,
  });
}
