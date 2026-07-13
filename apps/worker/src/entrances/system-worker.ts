import "dotenv/config";
import "../tracing.js";
import { configureBillingRuntime } from "@cohub/billing";
import { createLogger } from "@cohub/infra/logging";


import { DelayedError, Queue, Worker, type Processor } from "bullmq";
import {
  resolveQueueConcurrencyPerWorkerByName,
  attachWorkerEventLogger,
  closeWorkerGracefully,
  recordJobFailure,
  createBullmqRedisConnection,
  createQueueTelemetry,
  defaultJobRetention,
  getRedisHost,
  COHUB_SYSTEM_QUEUE,
} from "@cohub/infra/bullmq";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/infra/tracing/propagator";
import { assertRequiredConfig, config } from "../config.js";
import { getRegisteredSystemJobs, getSystemJobHandler } from "../system/registry.js";
import { SANDBOX_IDLE_REAPER_JOB } from "../system/jobs/sandbox-idle-reaper/types.js";
import { startSystemReferralRewardRetryLoop } from "../system/referral-reward-retry.js";

import "../system/jobs/index.js";

const SANDBOX_IDLE_REAPER_SCHEDULER_ID = "sandbox-idle-reaper-daily";
/** UTC 00:24 — offset from top-of-hour to reduce collisions with other daily jobs. */
const SANDBOX_IDLE_REAPER_CRON = "24 0 * * *";

const logger = createLogger({ serviceName: "cohub-worker" });
assertRequiredConfig();
configureBillingRuntime({
  config,
  redis: (await import("../redis.js")).redisCommandClient,
});

const connection = createBullmqRedisConnection(config.bullmqRedisUrl);

const tracer = getTracer("cohub-system-worker");

const processor: Processor = async (job) => {
  const handler = getSystemJobHandler(job.name);
  if (!handler) throw new Error(`No system handler registered for job: ${job.name}`);

  const parentCtx = extractTrace(job.data as unknown as Record<string, unknown>);
  const span = tracer.startSpan("system_worker.job.process", {
    attributes: {
      "job.id": job.id ?? "",
      "job.name": job.name,
      "job.queue": job.queueName,
      "job.attempt": job.attemptsMade,
    },
  });

  return context.with(trace.setSpan(parentCtx, span), async () => {
    try {
      return await handler(job);
    } catch (err) {
      // Idle check reschedules via moveToDelayed + DelayedError; not a failure.
      if (err instanceof DelayedError || (err instanceof Error && err.name === "DelayedError")) {
        span.setStatus({ code: SpanStatusCode.OK });
        throw err;
      }
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      await recordJobFailure(job, err, {
        reason: "system_job_failed",
        meta: {
          jobName: job.name,
          queueName: job.queueName,
        },
      });
      throw err;
    } finally {
      span.end();
    }
  });
};

const systemWorker = new Worker(COHUB_SYSTEM_QUEUE, processor, {
  connection,
  concurrency: resolveQueueConcurrencyPerWorkerByName(COHUB_SYSTEM_QUEUE),
  telemetry: createQueueTelemetry("cohub-system-worker"),
});

const systemQueue = new Queue(COHUB_SYSTEM_QUEUE, { connection });

attachWorkerEventLogger(systemWorker, {
  serviceName: "SystemWorker",
  queueName: COHUB_SYSTEM_QUEUE,
});

logger.info("[SystemWorker] Starting system worker...");
logger.info("[SystemWorker] BullMQ Redis:", getRedisHost(config.bullmqRedisUrl));
logger.info("[SystemWorker] App Redis:", getRedisHost(config.redisUrl));
logger.info("[SystemWorker] Queue:", COHUB_SYSTEM_QUEUE);
logger.info("[SystemWorker] Registered jobs:", getRegisteredSystemJobs());

try {
  await systemQueue.upsertJobScheduler(
    SANDBOX_IDLE_REAPER_SCHEDULER_ID,
    { pattern: SANDBOX_IDLE_REAPER_CRON, tz: "UTC" },
    {
      name: SANDBOX_IDLE_REAPER_JOB,
      data: {},
      opts: {
        attempts: 1,
        ...defaultJobRetention,
        removeOnComplete: { age: 7 * 24 * 3600, count: 30 },
        removeOnFail: { age: 14 * 24 * 3600, count: 50 },
      },
    },
  );
  logger.info("[SystemWorker] Ensured sandbox idle reaper schedule", {
    schedulerId: SANDBOX_IDLE_REAPER_SCHEDULER_ID,
    pattern: SANDBOX_IDLE_REAPER_CRON,
    tz: "UTC",
  });
} catch (error) {
  logger.error("[SystemWorker] Failed to ensure sandbox idle reaper schedule", {
    error: error instanceof Error ? error.message : String(error),
  });
}

const stopReferralRewardRetry = startSystemReferralRewardRetryLoop();

const shutdown = async (signal: string) => {
  logger.info(`[SystemWorker] Received ${signal}, shutting down...`);
  stopReferralRewardRetry();
  await closeWorkerGracefully(systemWorker, {
    serviceName: "SystemWorker",
    timeoutMs: Number(process.env.SYSTEM_WORKER_SHUTDOWN_TIMEOUT_MS ?? 30_000),
    pauseBeforeClose: true,
  });
  await systemQueue.close().catch(() => undefined);
  await connection.quit().catch(() => undefined);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
