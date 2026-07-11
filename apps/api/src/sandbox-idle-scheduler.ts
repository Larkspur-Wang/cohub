import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { config } from "./config.js";
import {
  SANDBOX_IDLE_CHECK_JOB,
  buildSandboxIdleCheckJobId,
  type SandboxIdleCheckJobData,
  type SpaceSandboxAutoDestroyPolicy,
} from "@cohub/sandbox-controller";

const queue = createBullmqQueue<SandboxIdleCheckJobData>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-sandbox-idle",
});

export async function enqueueSandboxIdleCheck(spaceId: string, delayMs: number) {
  return queue.add(SANDBOX_IDLE_CHECK_JOB, { spaceId }, {
    jobId: buildSandboxIdleCheckJobId(spaceId),
    delay: Math.max(0, delayMs),
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    ...defaultJobRetention,
  });
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

  await cancelSandboxIdleCheck(input.spaceId);
  const now = Date.now();
  const baseTime = input.baseAt?.getTime() ?? now;
  const dueAt = baseTime + input.policy.ttlSeconds * 1000;
  const delayMs = Math.max(0, dueAt - now);
  await enqueueSandboxIdleCheck(input.spaceId, delayMs);
  return { scheduled: true as const, mode: "idle" as const, dueAt: new Date(dueAt) };
}

export async function cancelSandboxIdleCheck(spaceId: string) {
  await queue.remove(buildSandboxIdleCheckJobId(spaceId)).catch(() => undefined);
}

export function buildSandboxAutoDestroyConfig(policy: SpaceSandboxAutoDestroyPolicy) {
  return { autoDestroy: policy };
}
