import "./tracing.js";

import { Worker, type Job, type Processor } from "bullmq";
import {
  attachWorkerEventLogger,
  closeWorkerGracefully,
  createBullmqRedisConnection,
  createQueueTelemetry,
} from "@cohub/infra/bullmq";
import { env } from "./env.js";
import { AGENT_SESSION_FORK_JOB_NAME, AGENT_TURN_JOB_NAME, AGENT_TURN_QUEUE_NAME, type AgentJobData, type AgentTurnJobData, type AgentSessionForkJobData } from "./queue.js";
import { processAgentTurnJob, disposeAllSessionHandles } from "./processor.js";
import { processSessionForkJob } from "./fork.js";
import { subscribeAbortEvents, closeAbortSubscriber } from "./abort.js";
import { getActiveAbortController } from "./active-turns.js";
import { closeDb } from "./db.js";
import { closeOwnershipRedis } from "./ownership.js";
import { closeRedisConnections } from "./redis.js";
import { closeSandboxPool } from "./sandbox-pool.js";

export const __test = {
  runInSessionOperation: async <T>(_handle: unknown, fn: () => Promise<T>) => fn(),
};

const connection = createBullmqRedisConnection(env.BULLMQ_REDIS_URL);

const processor: Processor<AgentJobData> = async (job) => {
  if (job.name === AGENT_SESSION_FORK_JOB_NAME) {
    return processSessionForkJob(job as Job<AgentSessionForkJobData>);
  }
  if (job.name === AGENT_TURN_JOB_NAME) {
    return processAgentTurnJob(job as Job<AgentTurnJobData>);
  }
  throw new Error(`Unknown agent job: ${job.name}`);
};

const worker = new Worker<AgentJobData>(AGENT_TURN_QUEUE_NAME, processor, {
  connection,
  concurrency: env.AGENT_WORKER_CONCURRENCY,
  lockDuration: env.AGENT_JOB_LOCK_DURATION_MS,
  lockRenewTime: env.AGENT_JOB_LOCK_RENEW_TIME_MS,
  stalledInterval: env.AGENT_JOB_STALLED_INTERVAL_MS,
  maxStalledCount: env.AGENT_JOB_MAX_STALLED_COUNT,
  telemetry: createQueueTelemetry("cohub-agent"),
});

attachWorkerEventLogger(worker, {
  serviceName: "AgentWorker",
  queueName: AGENT_TURN_QUEUE_NAME,
  logCompletedResult: true,
  shouldLogCompleted: (_job, result) => {
    const skipped = result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>).skipped
      : null;
    return skipped !== "session_busy";
  },
});

await subscribeAbortEvents((event) => {
  const controller = getActiveAbortController(event.turnId);
  controller?.abort();
});

console.log("[AgentWorker] Starting BullMQ agent worker...");
console.log("[AgentWorker] Queue:", AGENT_TURN_QUEUE_NAME);
console.log("[AgentWorker] Concurrency:", env.AGENT_WORKER_CONCURRENCY);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[AgentWorker] Received ${signal}, draining...`);
  await closeWorkerGracefully(worker, {
    serviceName: "AgentWorker",
    timeoutMs: env.AGENT_SHUTDOWN_DRAIN_TIMEOUT_MS,
    pauseBeforeClose: true,
  });
  await disposeAllSessionHandles();
  closeSandboxPool();
  await closeAbortSubscriber().catch(() => undefined);
  await closeOwnershipRedis().catch(() => undefined);
  await closeRedisConnections().catch(() => undefined);
  await closeDb().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
