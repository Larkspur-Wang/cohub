import { Hono } from "hono";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { workPromotions, workPromotionStatsHourly, works } from "@cohub/db";
import {
  encodeWorkPromotionStatsRedisField,
  WORK_PROMOTION_EVENT_KEYS,
  WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
  type WorkPromotionEventKey,
} from "@cohub/protocol";
import { db } from "../db/index.js";
import { authzDenied, requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import {
  getWorkPromotionProvider,
  listWorkPromotionProviders,
} from "../work-promotion-providers.js";

const router = new Hono();
const PROVIDER_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PARAMETER_KEYS = new Set([
  "utm_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);
const EVENT_KEYS = new Set<string>(WORK_PROMOTION_EVENT_KEYS);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATS_DAYS = 30;

function serializePromotion(row: typeof workPromotions.$inferSelect) {
  return {
    id: row.id,
    workId: row.workId,
    name: row.name,
    provider: row.provider,
    parameters: row.parameters,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function hasControlCharacters(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function parseParameters(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > PARAMETER_KEYS.size) return null;
  const parsed: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!PARAMETER_KEYS.has(key) || typeof raw !== "string") return null;
    const item = raw.trim();
    if (!item || item.length > 500 || hasControlCharacters(item)) return null;
    parsed[key] = item;
  }
  return parsed;
}

function toUtcHour(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
}

function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

router.get("/:workId/promotions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("workId");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: work.spaceId }))) return authzDenied(c);
  const promotions = await db
    .select()
    .from(workPromotions)
    .where(eq(workPromotions.workId, workId))
    .orderBy(asc(workPromotions.createdAt));
  return c.json({
    promotions: promotions.map(serializePromotion),
    providers: listWorkPromotionProviders(),
  });
});

router.post("/:workId/promotions", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("workId");
  if (!requireValidId(workId)) return c.json({ message: "work not found" }, 404);
  const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: work.spaceId }))) return authzDenied(c);
  if (work.status !== "published" || !work.currentVersionId) {
    return c.json({ message: "publish the Work before creating a promotion", code: "work_not_published" }, 409);
  }

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const providerKey = typeof body?.provider === "string" ? body.provider.trim() : "";
  const parameters = parseParameters(body?.parameters);
  if (!name || name.length > 120) return c.json({ message: "name must be between 1 and 120 characters" }, 400);
  if (!PROVIDER_RE.test(providerKey)) return c.json({ message: "provider is invalid" }, 400);
  const provider = getWorkPromotionProvider(providerKey);
  if (!provider) return c.json({ message: "promotion provider is unsupported", code: "promotion_provider_unsupported" }, 400);
  if (!provider.configured()) {
    return c.json({ message: "promotion provider is unavailable", code: "promotion_provider_unavailable" }, 409);
  }
  if (!parameters) return c.json({ message: "parameters must contain valid UTM values" }, 400);

  const promotionValues: typeof workPromotions.$inferInsert = {
    workId,
    name,
    provider: provider.key,
    parameters,
    createdBy: user.uuid,
  };
  const [promotion] = await db.insert(workPromotions).values(promotionValues).returning();
  if (!promotion) return c.json({ message: "promotion could not be created" }, 500);
  return c.json({ promotion: serializePromotion(promotion) }, 201);
});

router.get("/:workId/promotions/:promotionId/stats", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("workId");
  const promotionId = c.req.param("promotionId");
  if (!requireValidId(workId) || !requireValidId(promotionId)) return c.json({ message: "promotion not found" }, 404);
  const [promotion] = await db.select().from(workPromotions).where(and(
    eq(workPromotions.id, promotionId),
    eq(workPromotions.workId, workId),
  )).limit(1);
  if (!promotion) return c.json({ message: "promotion not found" }, 404);
  const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return c.json({ message: "work not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId: work.spaceId }))) return authzDenied(c);

  const now = new Date();
  const startDay = toUtcDay(new Date(now.getTime() - (STATS_DAYS - 1) * DAY_MS));
  const [totalRows, rows] = await Promise.all([
    db.select({
      eventKey: workPromotionStatsHourly.eventKey,
      eventCount: sql<string>`coalesce(sum(${workPromotionStatsHourly.eventCount}), 0)`,
    }).from(workPromotionStatsHourly)
      .where(eq(workPromotionStatsHourly.promotionId, promotionId))
      .groupBy(workPromotionStatsHourly.eventKey),
    db.select({
      bucketStartAt: workPromotionStatsHourly.bucketStartAt,
      eventKey: workPromotionStatsHourly.eventKey,
      eventCount: workPromotionStatsHourly.eventCount,
    }).from(workPromotionStatsHourly).where(and(
      eq(workPromotionStatsHourly.promotionId, promotionId),
      gte(workPromotionStatsHourly.bucketStartAt, startDay),
    )).orderBy(asc(workPromotionStatsHourly.bucketStartAt)),
  ]);

  const totals = { landing: 0, ready: 0 };
  const daily = new Map<string, { date: string; landing: number; ready: number }>();
  for (let offset = 0; offset < STATS_DAYS; offset += 1) {
    const date = new Date(startDay.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
    daily.set(date, { date, landing: 0, ready: 0 });
  }
  for (const row of totalRows) {
    if (row.eventKey !== "landing" && row.eventKey !== "ready") continue;
    const count = Number(row.eventCount);
    if (Number.isSafeInteger(count) && count > 0) totals[row.eventKey] = count;
  }
  for (const row of rows) {
    if (row.eventKey !== "landing" && row.eventKey !== "ready") continue;
    const count = Number(row.eventCount);
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    const date = row.bucketStartAt.toISOString().slice(0, 10);
    const point = daily.get(date);
    if (point) point[row.eventKey] += count;
  }
  return c.json({
    promotion: serializePromotion(promotion),
    summary: {
      ...totals,
      readyRate: totals.landing > 0 ? totals.ready / totals.landing : 0,
    },
    daily: Array.from(daily.values()),
  });
});

router.post("/:workId/promotions/:promotionId/events", async (c) => {
  const workId = c.req.param("workId");
  const promotionId = c.req.param("promotionId");
  if (!requireValidId(workId) || !requireValidId(promotionId)) return c.json({ message: "promotion not found" }, 404);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const eventKey = typeof body?.eventKey === "string" ? body.eventKey : "";
  const eventId = typeof body?.eventId === "string" && requireValidId(body.eventId) ? body.eventId : null;
  if (!EVENT_KEYS.has(eventKey)) return c.json({ message: "event is invalid" }, 400);
  if (!eventId) return c.json({ message: "eventId must be a UUID" }, 400);

  const [row] = await db.select({ promotion: workPromotions, work: works })
    .from(workPromotions)
    .innerJoin(works, eq(works.id, workPromotions.workId))
    .where(and(eq(workPromotions.id, promotionId), eq(workPromotions.workId, workId)))
    .limit(1);
  if (row?.work.status !== "published" || !row.work.currentVersionId) {
    return c.json({ message: "promotion not found" }, 404);
  }
  const workVersionId = row.work.currentVersionId;
  const provider = getWorkPromotionProvider(row.promotion.provider);
  if (!provider) return c.json({ message: "promotion provider is unavailable" }, 503);

  const bucketStartAt = toUtcHour(new Date());
  void import("../redis.js").then(({ redisBestEffortCommandClient }) => {
    if (redisBestEffortCommandClient.status !== "ready") return;
    return redisBestEffortCommandClient.hincrby(
      WORK_PROMOTION_STATS_ACTIVE_REDIS_KEY,
      encodeWorkPromotionStatsRedisField({
        promotionId,
        workVersionId,
        bucketStartAtMs: bucketStartAt.getTime(),
        eventKey: eventKey as WorkPromotionEventKey,
      }),
      1,
    );
  }).catch(() => undefined);

  const sourceUrl = typeof body?.sourceUrl === "string" && body.sourceUrl.length <= 2_048
    ? body.sourceUrl
    : undefined;
  const fbp = typeof body?.fbp === "string" && body.fbp.length <= 255 ? body.fbp : undefined;
  const fbc = typeof body?.fbc === "string" && body.fbc.length <= 255 ? body.fbc : undefined;
  void provider.deliver(c, {
    eventKey: eventKey as WorkPromotionEventKey,
    eventId,
    workId,
    promotionId,
    sourceUrl,
    fbp,
    fbc,
  });

  return c.json({
    ok: true,
    eventId,
    browser: provider.browserConfig(),
  });
});

export default router;
