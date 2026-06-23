import { Hono } from "hono";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import * as schema from "@cohub/db";
import { getOptionalAuth, requireValidId, authzDenied } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";
import { createLogger } from "@cohub/infra/logging";
import { aggregateUsageRows, buildUsageDateRange, resolveUsageDays, USAGE_SELECT_COLUMNS, type UsageRow } from "../../usage-aggregation.js";

const logger = createLogger({ serviceName: "cohub-api" });
const router = new Hono();

/**
 * GET /api/spaces/:spaceId/usage?days=N
 * Returns hourly token usage stats for a space over the last N days (default 30).
 */
router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return authzDenied(c);

  const days = resolveUsageDays(c.req.query("days"));
  const { startDate, now } = buildUsageDateRange(days);

  let rows: UsageRow[];
  try {
    rows = await db
      .select(USAGE_SELECT_COLUMNS)
      .from(schema.tokenUsageStatsHourly)
      .where(
        and(
          eq(schema.tokenUsageStatsHourly.spaceId, spaceId),
          gte(schema.tokenUsageStatsHourly.bucketStartAt, startDate),
          lte(schema.tokenUsageStatsHourly.bucketStartAt, now),
        ),
      )
      .orderBy(desc(schema.tokenUsageStatsHourly.bucketStartAt));
  } catch (error) {
    logger.error("[usage] DB query failed", error);
    return c.json({ message: "failed to load usage data" }, 500);
  }

  const { hourly, summary } = aggregateUsageRows(rows);
  return c.json({ hourly, summary, days });
});

export default router;
