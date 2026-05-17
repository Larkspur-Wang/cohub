import "dotenv/config";
import "../tracing.js";

import { Worker, type Processor } from "bullmq";
import {
  resolveQueueConcurrencyPerWorkerByName,
  attachWorkerEventLogger,
  closeWorkerGracefully,
  createBullmqRedisConnection,
  createQueueTelemetry,
  getRedisHost,
} from "@cohub/infra/bullmq";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/infra/tracing/propagator";
import { assertRequiredConfig, config } from "../config.js";
import { getRegisteredSystemJobs, getSystemJobHandler } from "../system/registry.js";
import { FS_CDN_QUEUE_NAME } from "../system/jobs/fs-cdn-cache/types.js";

import "../system/jobs/index.js";

assertRequiredConfig();

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
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
};

const systemWorker = new Worker(FS_CDN_QUEUE_NAME, processor, {
  connection,
  concurrency: resolveQueueConcurrencyPerWorkerByName(FS_CDN_QUEUE_NAME),
  telemetry: createQueueTelemetry("cohub-system-worker"),
});

attachWorkerEventLogger(systemWorker, {
  serviceName: "SystemWorker",
  queueName: FS_CDN_QUEUE_NAME,
});

console.log("[SystemWorker] Starting system worker...");
console.log("[SystemWorker] BullMQ Redis:", getRedisHost(config.bullmqRedisUrl));
console.log("[SystemWorker] App Redis:", getRedisHost(config.redisUrl));
console.log("[SystemWorker] Queue:", FS_CDN_QUEUE_NAME);
console.log("[SystemWorker] Registered jobs:", getRegisteredSystemJobs());

const shutdown = async (signal: string) => {
  console.log(`[SystemWorker] Received ${signal}, shutting down...`);
  await closeWorkerGracefully(systemWorker, {
    serviceName: "SystemWorker",
    timeoutMs: Number(process.env.FS_CDN_WORKER_SHUTDOWN_TIMEOUT_MS ?? 30_000),
    pauseBeforeClose: true,
  });
  await connection.quit().catch(() => undefined);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
