import "dotenv/config";
import "./tracing.js";

import { Worker, type Processor } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { Redis } from "ioredis";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/tracing/propagator";
import { config, assertRequiredConfig } from "./config.js";
import { getTaskHandler, getRegisteredTasks } from "./tasks/registry.js";

// Auto-register all tasks
import "./tasks/index.js";

assertRequiredConfig();

// BullMQ requires: maxRetriesPerRequest: null, enableReadyCheck: false
const connection = new Redis(config.bullmqRedisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

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

const taskWorker = new Worker("cohub-tasks", processor, {
  connection,
  concurrency: 5,
  telemetry: new BullMQOtel("cohub-worker"),
});

taskWorker.on("completed", (job, result) => {
  console.log(`[Worker] ✅ Job ${job.id} (${job.name}) completed:`, JSON.stringify(result));
});

taskWorker.on("failed", (job, err) => {
  console.error(`[Worker] ❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
});

taskWorker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

console.log("[Worker] Starting task worker...");

// 仅打印 host，不泄露任何凭证信息
const logHost = (() => {
  try {
    const url = new URL(config.bullmqRedisUrl);
    return url.host;
  } catch {
    return "(invalid URL)";
  }
})();
console.log("[Worker] BullMQ Redis:", logHost);
console.log("[Worker] API:", config.internalApiBaseUrl);
console.log("[Worker] Registered tasks:", getRegisteredTasks());

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`[Worker] Received ${signal}, shutting down...`);
  // Wait up to 30s for in-flight jobs to finish, then force close
  const closePromise = taskWorker.close();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
  await Promise.race([closePromise, timeout]);
  // Force close if graceful close didn't complete
  await taskWorker.close(true);
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
