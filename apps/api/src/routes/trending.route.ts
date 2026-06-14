import { Hono, type Context } from "hono";
import { sql, and, gte, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "@cohub/db";
import { getSpacePublicProfile } from "../lib/middleware.js";
import { fallbackPublicUserProfile, getProfilesByUuids } from "../user-profiles.js";
import { redisCommandClient } from "../redis.js";

const router = new Hono();

const TRENDING_HTTP_CACHE_MAX_AGE_SECONDS = 5 * 60;
const TRENDING_REDIS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const TRENDING_STALE_WHILE_REVALIDATE_SECONDS = 60 * 60;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function setTrendingCacheHeaders(c: Context) {
  c.header(
    "Cache-Control",
    `public, max-age=${TRENDING_HTTP_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${TRENDING_STALE_WHILE_REVALIDATE_SECONDS}`,
  );
}

function getTrendingCacheKey(name: string) {
  return `api:trending:${name}:${getYesterdayWindow().todayStart.toISOString()}`;
}

async function getCachedTrending<T>(name: string, load: () => Promise<T>): Promise<T> {
  const key = getTrendingCacheKey(name);

  try {
    const cached = await redisCommandClient.get(key);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    // Redis should not block the page.
  }

  const value = await load();

  try {
    await redisCommandClient.set(key, JSON.stringify(value), "EX", TRENDING_REDIS_CACHE_TTL_SECONDS);
  } catch {
    // Best-effort cache write.
  }

  return value;
}

/** Calculate yesterday's start (00:00) and today's start (00:00) as JS Dates */
function getYesterdayWindow() {
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  return { yesterdayStart, todayStart };
}

async function loadTrendingSpaces() {
  const { yesterdayStart, todayStart } = getYesterdayWindow();

  const rows = await db
    .select({
      spaceId: schema.tokenUsageStatsHourly.spaceId,
      totalTokens: sql<number>`SUM(${schema.tokenUsageStatsHourly.totalTokens})`.as("total_tokens"),
      costTotal: sql<string>`SUM(${schema.tokenUsageStatsHourly.costTotal})`.as("cost_total"),
      sessionCount: sql<number>`COUNT(DISTINCT ${schema.tokenUsageStatsHourly.sessionId})`.as("session_count"),
      requestCount: sql<number>`SUM(${schema.tokenUsageStatsHourly.requestCount})`.as("request_count"),
    })
    .from(schema.tokenUsageStatsHourly)
    .where(
      and(
        gte(schema.tokenUsageStatsHourly.bucketStartAt, yesterdayStart),
        lt(schema.tokenUsageStatsHourly.bucketStartAt, todayStart),
      ),
    )
    .groupBy(schema.tokenUsageStatsHourly.spaceId)
    .orderBy(sql`total_tokens DESC`)
    .limit(10);

  if (rows.length === 0) {
    return [];
  }

  const spaceIds = rows.map((r) => r.spaceId as string);

  const spaces = await db
    .select({
      id: schema.spaces.id,
      name: schema.spaces.name,
      userUuid: schema.spaces.userUuid,
      meta: schema.spaces.meta,
    })
    .from(schema.spaces)
    .where(sql`${schema.spaces.id} IN (${sql.join(spaceIds, sql`, `)})`);

  const nameMap = new Map(spaces.map((s) => [s.id, s.name]));
  const userMap = new Map(spaces.map((s) => [s.id, s.userUuid]));
  const spaceProfileMap = new Map(spaces.map((s) => [s.id, getSpacePublicProfile(s)]));
  const profileMap = await getProfilesByUuids(spaces.map((s) => s.userUuid));

  return rows.map((r, i) => {
    const uid = userMap.get(r.spaceId as string) ?? "";
    const userProfile = profileMap.get(uid) ?? fallbackPublicUserProfile(uid);
    return {
      rank: i + 1,
      spaceId: r.spaceId,
      spaceName: nameMap.get(r.spaceId) ?? r.spaceId.slice(0, 8),
      userId: uid,
      userDisplay: userProfile.displayName,
      userProfile,
      spaceProfile: spaceProfileMap.get(r.spaceId as string) ?? { avatarUrl: null },
      totalTokens: toFiniteNumber(r.totalTokens),
      costTotal: toFiniteNumber(r.costTotal),
      sessionCount: toFiniteNumber(r.sessionCount),
      requestCount: toFiniteNumber(r.requestCount),
    };
  });
}

async function loadTrendingUsers() {
  const { yesterdayStart, todayStart } = getYesterdayWindow();

  const rows = await db
    .select({
      userId: schema.tokenUsageStatsHourly.userId,
      totalTokens: sql<number>`SUM(${schema.tokenUsageStatsHourly.totalTokens})`.as("total_tokens"),
      costTotal: sql<string>`SUM(${schema.tokenUsageStatsHourly.costTotal})`.as("cost_total"),
      sessionCount: sql<number>`COUNT(DISTINCT ${schema.tokenUsageStatsHourly.sessionId})`.as("session_count"),
      requestCount: sql<number>`SUM(${schema.tokenUsageStatsHourly.requestCount})`.as("request_count"),
    })
    .from(schema.tokenUsageStatsHourly)
    .where(
      and(
        gte(schema.tokenUsageStatsHourly.bucketStartAt, yesterdayStart),
        lt(schema.tokenUsageStatsHourly.bucketStartAt, todayStart),
      ),
    )
    .groupBy(schema.tokenUsageStatsHourly.userId)
    .orderBy(sql`total_tokens DESC`)
    .limit(10);

  const profileMap = await getProfilesByUuids(
    rows.map((r) => r.userId).filter((userId): userId is string => Boolean(userId)),
  );

  return rows.map((r, i) => {
    const userId = r.userId ?? "";
    const userProfile = profileMap.get(userId) ?? fallbackPublicUserProfile(userId);
    return {
      rank: i + 1,
      userId,
      userDisplay: userProfile.displayName,
      userProfile,
      totalTokens: toFiniteNumber(r.totalTokens),
      costTotal: toFiniteNumber(r.costTotal),
      sessionCount: toFiniteNumber(r.sessionCount),
      requestCount: toFiniteNumber(r.requestCount),
    };
  });
}

async function loadTrendingModels() {
  const { yesterdayStart, todayStart } = getYesterdayWindow();

  const rows = await db
    .select({
      provider: schema.tokenUsageStatsHourly.provider,
      model: schema.tokenUsageStatsHourly.model,
      totalTokens: sql<number>`SUM(${schema.tokenUsageStatsHourly.totalTokens})`.as("total_tokens"),
      costTotal: sql<string>`SUM(${schema.tokenUsageStatsHourly.costTotal})`.as("cost_total"),
      sessionCount: sql<number>`COUNT(DISTINCT ${schema.tokenUsageStatsHourly.sessionId})`.as("session_count"),
      requestCount: sql<number>`SUM(${schema.tokenUsageStatsHourly.requestCount})`.as("request_count"),
    })
    .from(schema.tokenUsageStatsHourly)
    .where(
      and(
        gte(schema.tokenUsageStatsHourly.bucketStartAt, yesterdayStart),
        lt(schema.tokenUsageStatsHourly.bucketStartAt, todayStart),
      ),
    )
    .groupBy(schema.tokenUsageStatsHourly.provider, schema.tokenUsageStatsHourly.model)
    .orderBy(sql`total_tokens DESC`)
    .limit(10);

  return rows.map((r, i) => ({
    rank: i + 1,
    provider: r.provider ?? "unknown",
    model: r.model ?? "unknown",
    modelDisplay: `${r.provider ?? "unknown"}/${r.model ?? "unknown"}`,
    totalTokens: toFiniteNumber(r.totalTokens),
    costTotal: toFiniteNumber(r.costTotal),
    sessionCount: toFiniteNumber(r.sessionCount),
    requestCount: toFiniteNumber(r.requestCount),
  }));
}

// ─── Spaces ───────────────────────────────────────────────────────────

router.get("/spaces", async (c) => {
  setTrendingCacheHeaders(c);
  return c.json(await getCachedTrending("spaces", loadTrendingSpaces));
});

// ─── Users ────────────────────────────────────────────────────────────

router.get("/users", async (c) => {
  setTrendingCacheHeaders(c);
  return c.json(await getCachedTrending("users", loadTrendingUsers));
});

// ─── Models ───────────────────────────────────────────────────────────

router.get("/models", async (c) => {
  setTrendingCacheHeaders(c);
  return c.json(await getCachedTrending("models", loadTrendingModels));
});

export default router;
