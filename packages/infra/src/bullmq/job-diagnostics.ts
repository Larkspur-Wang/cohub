import type { Job } from "bullmq";
import { redactSensitiveData } from "../logging/logger.js";

const DEFAULT_STRING_LIMIT = 2_000;
const DEFAULT_LOG_LIMIT = 8_000;

export type JobFailureMeta = Record<string, unknown>;

export type RecordJobFailureOptions = {
  reason?: string;
  meta?: JobFailureMeta;
  progress?: boolean;
  log?: boolean;
};

export function serializeJobError(error: unknown) {
  if (error instanceof Error) {
    return truncateStrings({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  return truncateStrings(redactSensitiveData(error));
}

export async function recordJobFailure(job: Pick<Job, "id" | "name" | "queueName" | "attemptsMade" | "updateProgress" | "log">, error: unknown, options: RecordJobFailureOptions = {}) {
  const payload = truncateStrings(redactSensitiveData({
    stage: "failed",
    reason: options.reason ?? "job_failed",
    jobId: job.id,
    jobName: job.name,
    queueName: job.queueName,
    attempt: job.attemptsMade,
    ...options.meta,
    error: serializeJobError(error),
  })) as Record<string, unknown>;

  if (options.progress !== false) {
    await job.updateProgress(payload).catch(() => undefined);
  }
  if (options.log !== false) {
    await job.log(truncateString(JSON.stringify(payload), DEFAULT_LOG_LIMIT)).catch(() => undefined);
  }

  return payload;
}

export function truncateString(value: string, maxLength = DEFAULT_STRING_LIMIT) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function truncateStrings(value: unknown, maxLength = DEFAULT_STRING_LIMIT): unknown {
  if (typeof value === "string") return truncateString(value, maxLength);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => truncateStrings(item, maxLength));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, truncateStrings(nested, maxLength)]),
  );
}
