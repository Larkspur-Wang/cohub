import { Hono } from "hono";
import { sql, and, gte, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import * as schema from "@cohub/db";
import { getSpacePublicProfile } from "../lib/middleware.js";
import { fallbackPublicUserProfile, getProfilesByUuids } from "../user-profiles.js";

const router = new Hono();

/** Calculate yesterday's start (00:00) and today's start (00:00) as JS Dates */
function getYesterdayWindow() {
  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  return { yesterdayStart, todayStart };
}

// ─── Spaces ───────────────────────────────────────────────────────────

router.get("/spaces", async (c) => {
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
    return c.json([]);
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

  const result = rows.map((r, i) => {
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
      totalTokens: r.totalTokens ?? 0,
      costTotal: Number(r.costTotal ?? 0),
      sessionCount: Number(r.sessionCount),
      requestCount: r.requestCount ?? 0,
    };
  });

  return c.json(result);
});

// ─── Users ────────────────────────────────────────────────────────────

router.get("/users", async (c) => {
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

  const result = rows.map((r, i) => {
    const userId = r.userId ?? "";
    const userProfile = profileMap.get(userId) ?? fallbackPublicUserProfile(userId);
    return {
      rank: i + 1,
      userId,
      userDisplay: userProfile.displayName,
      userProfile,
      totalTokens: r.totalTokens ?? 0,
      costTotal: Number(r.costTotal ?? 0),
      sessionCount: Number(r.sessionCount),
      requestCount: r.requestCount ?? 0,
    };
  });

  return c.json(result);
});

// ─── Models ───────────────────────────────────────────────────────────

router.get("/models", async (c) => {
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

  const result = rows.map((r, i) => ({
    rank: i + 1,
    provider: r.provider ?? "unknown",
    model: r.model ?? "unknown",
    modelDisplay: `${r.provider ?? "unknown"}/${r.model ?? "unknown"}`,
    totalTokens: r.totalTokens ?? 0,
    costTotal: Number(r.costTotal ?? 0),
    sessionCount: Number(r.sessionCount),
    requestCount: r.requestCount ?? 0,
  }));

  return c.json(result);
});


export default router;
