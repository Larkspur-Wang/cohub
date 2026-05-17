import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  createCachedExploreConfig,
  EXPLORE_CACHE_TTL_SEC,
  parseCachedExploreConfig,
  parseExploreConfig,
  PLATFORM_EXPLORE_REDIS_KEY,
  type CachedExploreConfig,
  type ExploreConfig,
} from "@cohub/infra/config-runtime";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { accessPolicies, checkpoints, spaces } from "@cohub/db";
import { redisCommandClient } from "../redis.js";
import { getSpaceSandboxBySpaceId } from "../space-sandboxes.js";

const PLATFORM_EXPLORE_PATH = join(config.platformConfigRoot, "platform", ".cohub", "explore.json");
const inflightByKey = new Map<string, Promise<ExploreConfig | null>>();

async function loadExploreFromFile(input: {
  explorePath: string;
  redisKey: string;
  allowMissing: boolean;
}): Promise<CachedExploreConfig> {
  let rawText: string;
  try {
    rawText = await readFile(input.explorePath, "utf-8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (code === "ENOENT" && input.allowMissing) {
      const cached = createCachedExploreConfig({ content: null });
      await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", EXPLORE_CACHE_TTL_SEC);
      return cached;
    }
    if (code === "ENOENT") throw new Error("Explore config file not found");
    throw error;
  }

  let content: ExploreConfig;
  try {
    content = parseExploreConfig(rawText);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Explore config file is invalid JSON");
    throw error;
  }

  const cached = createCachedExploreConfig({ rawText, content });
  await redisCommandClient.set(input.redisKey, JSON.stringify(cached), "EX", EXPLORE_CACHE_TTL_SEC);
  return cached;
}

async function loadCachedExplore(input: {
  redisKey: string;
  explorePath: string;
  allowMissing: boolean;
}): Promise<ExploreConfig | null> {
  const inflight = inflightByKey.get(input.redisKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const cached = await redisCommandClient.get(input.redisKey);
    if (cached) {
      try {
        const parsed = parseCachedExploreConfig(cached);
        if (parsed) return parsed.content;
      } catch {
        // fall back to file
      }
    }
    return (await loadExploreFromFile(input)).content;
  })();

  inflightByKey.set(input.redisKey, promise);
  try {
    return await promise;
  } finally {
    inflightByKey.delete(input.redisKey);
  }
}

const router = new Hono();

router.get("/spaces", async (c) => {
  try {
    const exploreConfig = await loadCachedExplore({
      redisKey: PLATFORM_EXPLORE_REDIS_KEY,
      explorePath: PLATFORM_EXPLORE_PATH,
      allowMissing: true,
    });
    const configured = [...(exploreConfig?.spaces ?? [])]
      .filter((item) => item.spaceId)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    if (configured.length === 0) return c.json({ spaces: [] });

    const spaceIds = [...new Set(configured.map((item) => item.spaceId))];
    const spaceRows = await db.select().from(spaces).where(inArray(spaces.id, spaceIds));
    const policyRows = await db.select().from(accessPolicies).where(and(
      eq(accessPolicies.resourceType, "space"),
      inArray(accessPolicies.resourceId, spaceIds),
    ));

    const spacesById = new Map(spaceRows.map((space) => [space.id, space]));
    const policyBySpaceId = new Map(policyRows.map((policy) => [policy.resourceId, policy]));
    const visibleIds = configured
      .map((item) => item.spaceId)
      .filter((spaceId) => {
        const policy = policyBySpaceId.get(spaceId);
        return policy?.anonymousUserRole === "guest" || policy?.signedInUserRole === "guest" || policy?.signedInUserRole === "builder";
      });

    const checkpointRows = visibleIds.length > 0
      ? await db.execute(sql`
        select *
        from (
          select
            c.*,
            row_number() over (partition by c.space_id order by c.created_at desc) as rn
          from v2.checkpoints c
          where c.space_id in (${sql.join(visibleIds, sql`, `)})
        ) ranked
        where ranked.rn <= 3
        order by ranked.space_id, ranked.created_at desc
      `) as Array<typeof checkpoints.$inferSelect & { rn: number }>
      : [];
    const checkpointStats = visibleIds.length > 0
      ? await db
          .select({
            spaceId: checkpoints.spaceId,
            checkpointCount: sql<number>`count(*)::int`,
            forkCount: sql<number>`coalesce(sum(${checkpoints.forkCount}), 0)::int`,
          })
          .from(checkpoints)
          .where(inArray(checkpoints.spaceId, visibleIds))
          .groupBy(checkpoints.spaceId)
      : [];
    const pinCounts = visibleIds.length > 0
      ? await db.execute(sql`
        select m.space_id as "spaceId", count(*)::int as count
        from v2.space_marks m
        where m.kind = 'pin'
          and m.space_id in (${sql.join(visibleIds, sql`, `)})
          and (
            (m.resource_type = 'file')
            or (m.resource_type = 'session' and exists (
              select 1 from v2.space_sessions s where s.space_id = m.space_id and s.id::text = m.resource_ref
            ))
            or (m.resource_type = 'checkpoint' and exists (
              select 1 from v2.checkpoints c where c.space_id = m.space_id and c.id::text = m.resource_ref
            ))
          )
        group by m.space_id
      `) as Array<{ spaceId: string; count: number }>
      : [];
    const pinCountBySpaceId = new Map(pinCounts.map((row) => [row.spaceId, Number(row.count)]));
    const checkpointStatsBySpaceId = new Map(checkpointStats.map((row) => [row.spaceId, row]));
    const checkpointsBySpaceId = new Map<string, typeof checkpointRows>();
    for (const checkpoint of checkpointRows) {
      const list = checkpointsBySpaceId.get(checkpoint.spaceId) ?? [];
      list.push(checkpoint);
      checkpointsBySpaceId.set(checkpoint.spaceId, list);
    }

    const sandboxRows = await Promise.all(visibleIds.map(async (spaceId) => [spaceId, await getSpaceSandboxBySpaceId(spaceId)] as const));
    const sandboxBySpaceId = new Map(sandboxRows);

    const items = configured.flatMap((entry) => {
      if (!visibleIds.includes(entry.spaceId)) return [];
      const space = spacesById.get(entry.spaceId);
      const policy = policyBySpaceId.get(entry.spaceId);
      if (!space || !policy) return [];
      const spaceCheckpoints = checkpointsBySpaceId.get(space.id) ?? [];
      return [{
        space,
        accessAudience: policy.anonymousUserRole ? "anonymous" : "signed_in",
        explore: {
          rank: entry.rank ?? 0,
          category: entry.category ?? null,
          label: entry.label ?? null,
        },
        latestCheckpoints: spaceCheckpoints.slice(0, 3),
        stats: {
          pinnedCount: pinCountBySpaceId.get(space.id) ?? 0,
          checkpointCount: checkpointStatsBySpaceId.get(space.id)?.checkpointCount ?? 0,
          forkCount: checkpointStatsBySpaceId.get(space.id)?.forkCount ?? 0,
        },
        sandboxStatus: sandboxBySpaceId.get(space.id)?.status ?? null,
      }];
    });

    return c.json({ spaces: items });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Failed to load explore spaces" }, 502);
  }
});

export default router;
