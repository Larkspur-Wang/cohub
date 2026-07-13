import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { config } from "./config.js";
import {
  SANDBOX_IDLE_CHECK_JOB,
  SANDBOX_IDLE_CHECK_JOB_ATTEMPTS,
  SANDBOX_IDLE_CHECK_JOB_BACKOFF_MS,
  buildSandboxIdleCheckJobId,
  computeSandboxIdleCheckDelayMs,
  type SandboxIdleCheckJobData,
  type SpaceSandboxAutoDestroyPolicy,
} from "@cohub/sandbox-controller";

const queue = createBullmqQueue<SandboxIdleCheckJobData>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-sandbox-idle",
});

const idleCheckJobOpts = {
  attempts: SANDBOX_IDLE_CHECK_JOB_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: SANDBOX_IDLE_CHECK_JOB_BACKOFF_MS },
  ...defaultJobRetention,
};

export type EnqueueSandboxIdleCheckResult = {
  jobId: string;
  /** How the single fixed jobId was reconciled. */
  action: "added" | "changed" | "active";
};

/**
 * Ensure one delayed idle_check per space (fixed jobId).
 *
 * BullMQ keeps job keys for completed/failed retention and will no-op add when
 * the key still exists, so we must reconcile by state:
 * - delayed → changeDelay
 * - active → leave it (worker re-reads DB before moveToDelayed)
 * - waiting / completed / failed / missing → remove then add
 */
export async function enqueueSandboxIdleCheck(
  spaceId: string,
  delayMs: number,
): Promise<EnqueueSandboxIdleCheckResult> {
  const jobId = buildSandboxIdleCheckJobId(spaceId);
  const delay = Math.max(0, delayMs);

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => "unknown" as const);
    if (state === "delayed") {
      await existing.changeDelay(delay);
      return { jobId, action: "changed" };
    }
    if (state === "active") {
      // Worker holds the lock; its not_due path re-reads dueAt from DB.
      return { jobId, action: "active" };
    }
    await existing.remove().catch(() => undefined);
  }

  await queue.add(SANDBOX_IDLE_CHECK_JOB, { spaceId }, {
    jobId,
    delay,
    ...idleCheckJobOpts,
  });
  return { jobId, action: "added" };
}

export async function enqueueSandboxIdleCheckAt(spaceId: string, dueAt: Date) {
  return enqueueSandboxIdleCheck(spaceId, computeSandboxIdleCheckDelayMs(dueAt));
}

export async function scheduleSandboxAutoDestroy(input: {
  spaceId: string;
  policy: SpaceSandboxAutoDestroyPolicy;
  baseAt?: Date | null;
}) {
  if (input.policy.mode === "never") {
    await cancelSandboxIdleCheck(input.spaceId);
    return { scheduled: false as const, mode: "never" as const };
  }

  const now = Date.now();
  const baseTime = input.baseAt?.getTime() ?? now;
  const dueAt = new Date(baseTime + input.policy.ttlSeconds * 1000);
  const enqueued = await enqueueSandboxIdleCheckAt(input.spaceId, dueAt);
  return { scheduled: true as const, mode: "idle" as const, dueAt, ...enqueued };
}

export async function cancelSandboxIdleCheck(spaceId: string) {
  const jobId = buildSandboxIdleCheckJobId(spaceId);
  const existing = await queue.getJob(jobId);
  if (!existing) return;
  const state = await existing.getState().catch(() => "unknown" as const);
  // Never interrupt an in-flight check; it will finish without re-arm when policy is never.
  if (state === "active") return;
  await existing.remove().catch(() => undefined);
}

export function buildSandboxAutoDestroyConfig(policy: SpaceSandboxAutoDestroyPolicy) {
  return { autoDestroy: policy };
}
