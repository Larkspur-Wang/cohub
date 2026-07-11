import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import {
  SANDBOX_IDLE_CHECK_JOB,
  buildSandboxIdleCheckJobId,
  type SandboxIdleCheckJobData,
} from "@cohub/sandbox-controller";
import { config } from "../config.js";

const queue = createBullmqQueue<SandboxIdleCheckJobData>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-sandbox-idle",
});

export async function enqueueSandboxIdleCheckAt(spaceId: string, dueAt: Date) {
  const dedupeId = buildSandboxIdleCheckJobId(spaceId);
  const delayMs = Math.max(0, dueAt.getTime() - Date.now());
  return queue.add(SANDBOX_IDLE_CHECK_JOB, { spaceId }, {
    jobId: `${dedupeId}-${dueAt.getTime()}`,
    delay: delayMs,
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    ...defaultJobRetention,
    deduplication: {
      id: dedupeId,
      replace: true,
      keepLastIfActive: true,
    },
  });
}
