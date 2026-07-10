import { sql } from "drizzle-orm";
import { generationUsageStatsHourly } from "@cohub/db";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";

/** Placeholder session id when a generation has no session context. */
export const GENERATION_USAGE_SESSION_NONE = "00000000-0000-4000-8000-000000000000";

/** Sentinel values keep unique-key dimensions NOT NULL for reliable upserts. */
export const GENERATION_USAGE_USER_UNKNOWN = "unknown";
export const GENERATION_USAGE_PROVIDER_UNKNOWN = "unknown";
export const GENERATION_USAGE_MODEL_UNKNOWN = "unknown";

const STATS_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

export function toUtcHourBucket(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0,
  ));
}

function normalizeRequired(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function statsIdempotencyKey(taskRunId: string): string {
  return `cohub:generation-usage-stats:${taskRunId}`;
}

/**
 * Atomically claim a one-shot stats write for this task run.
 * Returns false when already claimed. Fail-open (true) if Redis is down.
 */
async function claimGenerationStatsWrite(taskRunId: string): Promise<{ claimed: boolean; key: string | null }> {
  const id = normalizeNullable(taskRunId);
  if (!id) return { claimed: true, key: null };
  const key = statsIdempotencyKey(id);
  try {
    const result = await redisCommandClient.set(key, "1", "EX", STATS_IDEMPOTENCY_TTL_SECONDS, "NX");
    return { claimed: result === "OK", key };
  } catch {
    // Prefer recording over dropping when Redis is unavailable (rare double-count possible).
    return { claimed: true, key: null };
  }
}

async function releaseGenerationStatsWrite(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await redisCommandClient.del(key);
  } catch {
    // Best-effort release; TTL will expire the lock if delete fails.
  }
}

/**
 * Upsert one successful multimodal generation into the hourly stats rollup.
 *
 * - Dimensions use non-null sentinels so ON CONFLICT works reliably.
 * - `provider` is the generation adapter type (e.g. `openai.images`).
 * - Optional `taskRunId` is claimed via Redis SET NX; released if the DB write fails.
 * - Failures should be handled by callers (best-effort, never fail the task).
 */
export async function recordGenerationUsageStatsHourly(input: {
  bucketStartAt?: Date;
  taskRunId?: string | null;
  userId: string | null;
  spaceId: string;
  sessionId?: string | null;
  usageType: string;
  /** Generation adapter type, stored in the `provider` column. */
  adapterType?: string | null;
  model?: string | null;
  costTotal?: number | null;
}): Promise<{ recorded: boolean }> {
  const claim = await claimGenerationStatsWrite(input.taskRunId ?? "");
  if (!claim.claimed) return { recorded: false };

  const bucketStartAt = input.bucketStartAt ?? toUtcHourBucket(new Date());
  const userId = normalizeRequired(input.userId, GENERATION_USAGE_USER_UNKNOWN);
  const sessionId = normalizeNullable(input.sessionId) ?? GENERATION_USAGE_SESSION_NONE;
  const usageType = normalizeRequired(input.usageType, "generation");
  const provider = normalizeRequired(input.adapterType, GENERATION_USAGE_PROVIDER_UNKNOWN);
  const model = normalizeRequired(input.model, GENERATION_USAGE_MODEL_UNKNOWN);
  const costTotal = typeof input.costTotal === "number" && Number.isFinite(input.costTotal) && input.costTotal > 0
    ? Number(input.costTotal.toFixed(8))
    : 0;

  try {
    await db.insert(generationUsageStatsHourly).values({
      bucketStartAt,
      userId,
      spaceId: input.spaceId,
      sessionId,
      usageType,
      provider,
      model,
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      costTotal: String(costTotal),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        generationUsageStatsHourly.bucketStartAt,
        generationUsageStatsHourly.userId,
        generationUsageStatsHourly.spaceId,
        generationUsageStatsHourly.sessionId,
        generationUsageStatsHourly.usageType,
        generationUsageStatsHourly.provider,
        generationUsageStatsHourly.model,
      ],
      set: {
        requestCount: sql`${generationUsageStatsHourly.requestCount} + 1`,
        successCount: sql`${generationUsageStatsHourly.successCount} + 1`,
        costTotal: sql`${generationUsageStatsHourly.costTotal} + ${String(costTotal)}::numeric`,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    // Allow a later retry of the same taskRunId to claim again.
    await releaseGenerationStatsWrite(claim.key);
    throw error;
  }

  return { recorded: true };
}
