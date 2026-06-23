import { tokenUsageStatsHourly } from "@cohub/db";

const toFiniteNumber = (value: unknown): number => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

export type UsageRow = {
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

type HourlyBucket = {
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
};

export type UsageAggregationResult = {
  hourly: Array<Omit<HourlyBucket, "models"> & { models: string[] }>;
  summary: {
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
  };
};

/**
 * Aggregate raw usage rows (potentially multiple per hour due to model/provider
 * dimensions) into hourly buckets and a summary. Shared by space-level and
 * user-level usage endpoints.
 */
export function aggregateUsageRows(rows: readonly UsageRow[]): UsageAggregationResult {
  const hourlyMap = new Map<string, HourlyBucket>();

  for (const row of rows) {
    const key = (row.bucketStartAt as Date).toISOString();
    const existing = hourlyMap.get(key);
    if (existing) {
      existing.totalTokens += row.totalTokens ?? 0;
      existing.inputTokens += row.inputTokens ?? 0;
      existing.outputTokens += row.outputTokens ?? 0;
      existing.cacheReadTokens += row.cacheReadTokens ?? 0;
      existing.cacheWriteTokens += row.cacheWriteTokens ?? 0;
      existing.costInput += toFiniteNumber(row.costInput);
      existing.costOutput += toFiniteNumber(row.costOutput);
      existing.costCacheRead += toFiniteNumber(row.costCacheRead);
      existing.costCacheWrite += toFiniteNumber(row.costCacheWrite);
      existing.costTotal += toFiniteNumber(row.costTotal);
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
        costInput: toFiniteNumber(row.costInput),
        costOutput: toFiniteNumber(row.costOutput),
        costCacheRead: toFiniteNumber(row.costCacheRead),
        costCacheWrite: toFiniteNumber(row.costCacheWrite),
        costTotal: toFiniteNumber(row.costTotal),
        requestCount: row.requestCount ?? 0,
        successCount: row.successCount ?? 0,
        errorCount: row.errorCount ?? 0,
        models: row.model ? new Set([row.model]) : new Set(),
      });
    }
  }

  const hourly = Array.from(hourlyMap.values())
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

  const summary = hourly.reduce(
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

  return { hourly, summary };
}

/** Column selection shared by all usage queries. */
export const USAGE_SELECT_COLUMNS = {
  bucketStartAt: tokenUsageStatsHourly.bucketStartAt,
  totalTokens: tokenUsageStatsHourly.totalTokens,
  inputTokens: tokenUsageStatsHourly.inputTokens,
  outputTokens: tokenUsageStatsHourly.outputTokens,
  cacheReadTokens: tokenUsageStatsHourly.cacheReadTokens,
  cacheWriteTokens: tokenUsageStatsHourly.cacheWriteTokens,
  costInput: tokenUsageStatsHourly.costInput,
  costOutput: tokenUsageStatsHourly.costOutput,
  costCacheRead: tokenUsageStatsHourly.costCacheRead,
  costCacheWrite: tokenUsageStatsHourly.costCacheWrite,
  costTotal: tokenUsageStatsHourly.costTotal,
  requestCount: tokenUsageStatsHourly.requestCount,
  successCount: tokenUsageStatsHourly.successCount,
  errorCount: tokenUsageStatsHourly.errorCount,
  model: tokenUsageStatsHourly.model,
} as const;

export const resolveUsageDays = (daysParam: string | undefined): number => {
  const parsedDays = parseInt(daysParam ?? "", 10);
  return Number.isFinite(parsedDays) && parsedDays > 0 ? Math.min(parsedDays, 365) : 30;
};

export const buildUsageDateRange = (days: number) => {
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 86400000);
  startDate.setUTCMinutes(0, 0, 0);
  return { startDate, now };
};
