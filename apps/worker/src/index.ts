import "dotenv/config";
import "./tracing.js";

import { Worker, type Processor } from "bullmq";
import {
  attachWorkerEventLogger,
  closeWorkerGracefully,
  COHUB_TASKS_QUEUE,
  createBullmqRedisConnection,
  createQueueTelemetry,
  getRedisHost,
} from "@cohub/bullmq-ops";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/tracing/propagator";
import { config, assertRequiredConfig } from "./config.js";
import { getTaskHandler, getRegisteredTasks } from "./tasks/registry.js";

// Auto-register all tasks
import "./tasks/index.js";

assertRequiredConfig();

const connection = createBullmqRedisConnection(config.bullmqRedisUrl);

const tracer = getTracer("cohub-worker");

const processor: Processor = async (job) => {
  const handler = getTaskHandler(job.name);
  if (!handler) {
    throw new Error(`No handler registered for task type: ${job.name}`);
  }
  // Extract trace context from job data (if enqueued with trace propagation)
  const parentCtx = extractTrace(job.data as unknown as Record<string, unknown>);
  const span = tracer.startSpan("worker.job.process", {
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

const taskWorker = new Worker(COHUB_TASKS_QUEUE, processor, {
  connection,
  concurrency: Number(process.env.TASK_WORKER_CONCURRENCY ?? 5),
  telemetry: createQueueTelemetry("cohub-worker"),
});

attachWorkerEventLogger(taskWorker, {
  serviceName: "Worker",
  queueName: COHUB_TASKS_QUEUE,
  logCompletedResult: true,
});

console.log("[Worker] Starting task worker...");
console.log("[Worker] BullMQ Redis:", getRedisHost(config.bullmqRedisUrl));
console.log("[Worker] App Redis:", getRedisHost(config.redisUrl));
console.log("[Worker] API:", config.internalApiBaseUrl);
console.log("[Worker] Registered tasks:", getRegisteredTasks());

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`[Worker] Received ${signal}, shutting down...`);
  await closeWorkerGracefully(taskWorker, {
    serviceName: "Worker",
    timeoutMs: Number(process.env.TASK_WORKER_SHUTDOWN_TIMEOUT_MS ?? 30_000),
    pauseBeforeClose: true,
  });
  await connection.quit().catch(() => undefined);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
