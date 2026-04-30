import { Hono } from "hono";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../db/index.js";
import * as schema from "../../db/schema-v2.js";
import { getOptionalAuth, requireValidId } from "../../lib/middleware.js";
import { hasPermission } from "../../permissions.js";

const router = new Hono();

/**
 * GET /api/spaces/:spaceId/usage?days=N
 * Returns hourly token usage stats for a space over the last N days (default 30).
 */
router.get("/", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!spaceId || !requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const daysParam = c.req.query("days");
  const parsedDays = parseInt(daysParam ?? "", 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 30;

  const now = new Date();
  const startDate = new Date(now.getTime() - days * 86400000);
  // Truncate to hour boundary
  startDate.setUTCMinutes(0, 0, 0);

  type UsageRow = {
    bucketStartAt: Date;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costInput: string;
    costOutput: string;
    costCacheRead: string;
    costCacheWrite: string;
    costTotal: string;
    requestCount: number;
    successCount: number;
    errorCount: number;
    model: string | null;
  };

  let rows: UsageRow[];
  try {
    rows = await db
      .select({
        bucketStartAt: schema.tokenUsageStatsHourly.bucketStartAt,
        totalTokens: schema.tokenUsageStatsHourly.totalTokens,
        inputTokens: schema.tokenUsageStatsHourly.inputTokens,
        outputTokens: schema.tokenUsageStatsHourly.outputTokens,
        cacheReadTokens: schema.tokenUsageStatsHourly.cacheReadTokens,
        cacheWriteTokens: schema.tokenUsageStatsHourly.cacheWriteTokens,
        costInput: schema.tokenUsageStatsHourly.costInput,
        costOutput: schema.tokenUsageStatsHourly.costOutput,
        costCacheRead: schema.tokenUsageStatsHourly.costCacheRead,
        costCacheWrite: schema.tokenUsageStatsHourly.costCacheWrite,
        costTotal: schema.tokenUsageStatsHourly.costTotal,
        requestCount: schema.tokenUsageStatsHourly.requestCount,
        successCount: schema.tokenUsageStatsHourly.successCount,
        errorCount: schema.tokenUsageStatsHourly.errorCount,
        model: schema.tokenUsageStatsHourly.model,
      })
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
    console.error("[usage] DB query failed", error);
    return c.json({ message: "Failed to load usage data" }, 500);
  }

  // Aggregate by hour (in case there are multiple model/provider rows per hour)
  const hourlyMap = new Map<string, {
    bucketStartAt: Date;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costInput: number;
    costOutput: number;
    costCacheRead: number;
    costCacheWrite: number;
    costTotal: number;
    requestCount: number;
    successCount: number;
    errorCount: number;
    models: Set<string>;
  }>();

  for (const row of rows) {
    const key = (row.bucketStartAt as Date).toISOString();
    const existing = hourlyMap.get(key);
    if (existing) {
      existing.totalTokens += row.totalTokens ?? 0;
      existing.inputTokens += row.inputTokens ?? 0;
      existing.outputTokens += row.outputTokens ?? 0;
      existing.cacheReadTokens += row.cacheReadTokens ?? 0;
      existing.cacheWriteTokens += row.cacheWriteTokens ?? 0;
      existing.costInput = Number(existing.costInput) + Number(row.costInput ?? 0);
      existing.costOutput = Number(existing.costOutput) + Number(row.costOutput ?? 0);
      existing.costCacheRead = Number(existing.costCacheRead) + Number(row.costCacheRead ?? 0);
      existing.costCacheWrite = Number(existing.costCacheWrite) + Number(row.costCacheWrite ?? 0);
      existing.costTotal = Number(existing.costTotal) + Number(row.costTotal ?? 0);
      existing.requestCount += row.requestCount ?? 0;
      existing.successCount += row.successCount ?? 0;
      existing.errorCount += row.errorCount ?? 0;
      if (row.model) existing.models.add(row.model);
    } else {
      hourlyMap.set(key, {
        bucketStartAt: row.bucketStartAt as Date,
        totalTokens: row.totalTokens ?? 0,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cacheReadTokens: row.cacheReadTokens ?? 0,
        cacheWriteTokens: row.cacheWriteTokens ?? 0,
        costInput: Number(row.costInput ?? 0),
        costOutput: Number(row.costOutput ?? 0),
        costCacheRead: Number(row.costCacheRead ?? 0),
        costCacheWrite: Number(row.costCacheWrite ?? 0),
        costTotal: Number(row.costTotal ?? 0),
        requestCount: row.requestCount ?? 0,
        successCount: row.successCount ?? 0,
        errorCount: row.errorCount ?? 0,
        models: row.model ? new Set([row.model]) : new Set(),
      });
    }
  }

  // Convert to array and sort by time
  const hourlyStats = Array.from(hourlyMap.values())
    .sort((a, b) => a.bucketStartAt.getTime() - b.bucketStartAt.getTime())
    .map(({ models, ...rest }) => ({
      ...rest,
      models: Array.from(models),
      costInput: Number(rest.costInput.toFixed(4)),
      costOutput: Number(rest.costOutput.toFixed(4)),
      costCacheRead: Number(rest.costCacheRead.toFixed(4)),
      costCacheWrite: Number(rest.costCacheWrite.toFixed(4)),
      costTotal: Number(rest.costTotal.toFixed(4)),
    }));

  // Compute summary
  const summary = hourlyStats.reduce(
    (acc, stat) => ({
      totalTokens: acc.totalTokens + stat.totalTokens,
      inputTokens: acc.inputTokens + stat.inputTokens,
      outputTokens: acc.outputTokens + stat.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + stat.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + stat.cacheWriteTokens,
      costInput: Number((acc.costInput + stat.costInput).toFixed(4)),
      costOutput: Number((acc.costOutput + stat.costOutput).toFixed(4)),
      costCacheRead: Number((acc.costCacheRead + stat.costCacheRead).toFixed(4)),
      costCacheWrite: Number((acc.costCacheWrite + stat.costCacheWrite).toFixed(4)),
      costTotal: Number((acc.costTotal + stat.costTotal).toFixed(4)),
      requestCount: acc.requestCount + stat.requestCount,
      successCount: acc.successCount + stat.successCount,
      errorCount: acc.errorCount + stat.errorCount,
    }),
    {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costInput: 0,
      costOutput: 0,
      costCacheRead: 0,
      costCacheWrite: 0,
      costTotal: 0,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
    },
  );

  return c.json({ hourly: hourlyStats, summary, days });
});

export default router;
