import { Hono } from "hono";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { userProfiles, workPromotions, workPromotionStatsHourly, works } from "@cohub/db";
import type { WorkPromotionEventKey } from "@cohub/protocol";
import { db } from "../db/index.js";
import { authzDenied, requireValidId, useAuth } from "../lib/middleware.js";
import { hasPermission } from "../permissions.js";
import {
  getWorkPromotionProvider,
  listWorkPromotionProviders,
} from "../work-promotion-providers.js";
import {
  recordResolvedWorkPromotionEvent,
  resolvePublishedWorkPromotion,
} from "../work-promotion-events.js";

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
const PUBLIC_EVENT_KEYS = new Set<WorkPromotionEventKey>([
  "landing",
  "ready",
  "paywall_viewed",
]);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATS_DAYS = 30;
const EVENT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const REGISTRATION_WINDOW_MS = 10 * 60 * 1_000;

type PromotionCounts = {
  landing: number;
  ready: number;
  registrationCompleted: number;
  paywallViewed: number;
  checkoutStarted: number;
};

const emptyPromotionCounts = (): PromotionCounts => ({
  landing: 0,
  ready: 0,
  registrationCompleted: 0,
  paywallViewed: 0,
  checkoutStarted: 0,
});

function promotionCountKey(eventKey: string): keyof PromotionCounts | null {
  if (eventKey === "landing" || eventKey === "ready") return eventKey;
  if (eventKey === "registration_completed") return "registrationCompleted";
  if (eventKey === "paywall_viewed") return "paywallViewed";
  if (eventKey === "checkout_started") return "checkoutStarted";
  return null;
}

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

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength ? value : undefined;
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

  const totals = emptyPromotionCounts();
  const daily = new Map<string, { date: string } & PromotionCounts>();
  for (let offset = 0; offset < STATS_DAYS; offset += 1) {
    const date = new Date(startDay.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
    daily.set(date, { date, ...emptyPromotionCounts() });
  }
  for (const row of totalRows) {
    const key = promotionCountKey(row.eventKey);
    if (!key) continue;
    const count = Number(row.eventCount);
    if (Number.isSafeInteger(count) && count > 0) totals[key] = count;
  }
  for (const row of rows) {
    const key = promotionCountKey(row.eventKey);
    if (!key) continue;
    const count = Number(row.eventCount);
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    const date = row.bucketStartAt.toISOString().slice(0, 10);
    const point = daily.get(date);
    if (point) point[key] += count;
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
  const eventId = typeof body?.eventId === "string" && EVENT_ID_RE.test(body.eventId) ? body.eventId : null;
  if (!PUBLIC_EVENT_KEYS.has(eventKey as WorkPromotionEventKey)) {
    return c.json({ message: "event is invalid" }, 400);
  }
  if (!eventId) return c.json({ message: "eventId is invalid" }, 400);

  const row = await resolvePublishedWorkPromotion(workId, promotionId);
  if (!row) return c.json({ message: "promotion not found" }, 404);
  const sourceUrl = boundedString(body?.sourceUrl, 2_048);
  const fbp = boundedString(body?.fbp, 255);
  const fbc = boundedString(body?.fbc, 255);
  const productKey = boundedString(body?.productKey, 128);
  const browser = recordResolvedWorkPromotionEvent(c, {
    promotion: row.promotion,
    workVersionId: row.work.currentVersionId,
    eventKey: eventKey as WorkPromotionEventKey,
    eventId,
    sourceUrl,
    fbp,
    fbc,
    productKey,
  });
  if (!browser) return c.json({ message: "promotion provider is unavailable" }, 503);
  return c.json({ ok: true, eventId, browser });
});

router.post("/:workId/promotions/:promotionId/registration", async (c) => {
  const user = useAuth(c);
  if (user instanceof Response) return user;
  const workId = c.req.param("workId");
  const promotionId = c.req.param("promotionId");
  if (!requireValidId(workId) || !requireValidId(promotionId)) return c.json({ message: "promotion not found" }, 404);
  const row = await resolvePublishedWorkPromotion(workId, promotionId);
  if (!row) return c.json({ message: "promotion not found" }, 404);
  const [profile] = await db.select({ createdAt: userProfiles.createdAt })
    .from(userProfiles)
    .where(eq(userProfiles.userUuid, user.uuid))
    .limit(1);
  if (!profile?.createdAt || Date.now() - profile.createdAt.getTime() > REGISTRATION_WINDOW_MS) {
    return c.json({ reported: false, eventId: null, browser: null });
  }
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const eventId = `registration_${user.uuid}`;
  const browser = recordResolvedWorkPromotionEvent(c, {
    promotion: row.promotion,
    workVersionId: row.work.currentVersionId,
    eventKey: "registration_completed",
    eventId,
    sourceUrl: boundedString(body?.sourceUrl, 2_048),
    fbp: boundedString(body?.fbp, 255),
    fbc: boundedString(body?.fbc, 255),
  });
  return c.json({ reported: true, eventId, browser });
});

export default router;
