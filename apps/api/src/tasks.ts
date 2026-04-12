import { Queue, type JobsOptions } from "bullmq";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { cronJobs, taskRuns } from "./db/schema.js";
import type { TaskPayload, TaskScheduleConfig } from "@cohub/protocol";

const QUEUE_NAME = "cohub-tasks";

// Use connection string to avoid ioredis type version mismatch across pnpm resolutions
const connection = { url: config.redisUrl };

export const taskQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Enqueue a one-off task and create its task_runs record (status=pending).
 */
export const enqueueTask = async (payload: TaskPayload, opts?: JobsOptions) => {
  const job = await taskQueue.add(payload.type, payload, opts);

  const jobId = job.id;
  if (!jobId) throw new Error("Failed to get job id");

  await db.insert(taskRuns).values({
    jobId,
    taskType: payload.type,
    workspaceId: payload.workspaceId ?? null,
    runtimeId: payload.runtimeId ?? null,
    sessionId: payload.sessionId ?? null,
    userUuid: payload.userId ?? null,
    cronJobId: payload.cronJobId ?? null,
    status: "pending",
    payload,
    scheduledAt: opts?.delay ? new Date(Date.now() + opts.delay) : null,
  });

  return job;
};

/**
 * Create a cron-scheduled task.
 * Writes cron_jobs record + sets up BullMQ repeatable job.
 * Does NOT write task_runs — those are created by the Worker on each execution.
 */
export const createCronJob = async (params: {
  userId: string;
  title: string;
  taskType: string;
  payload: Record<string, unknown>;
  schedule: TaskScheduleConfig;
  workspaceId?: string | null;
  runtimeId?: string | null;
  sessionId?: string | null;
}) => {
  const taskPayload: TaskPayload = {
    type: params.taskType,
    workspaceId: params.workspaceId ?? undefined,
    runtimeId: params.runtimeId ?? undefined,
    sessionId: params.sessionId ?? undefined,
    userId: params.userId,
    data: params.payload,
  };

  const cronJobResult = await db.insert(cronJobs).values({
    userUuid: params.userId,
    title: params.title,
    taskType: params.taskType,
    payload: params.payload,
    cronExpression: params.schedule.pattern,
    timezone: params.schedule.timezone ?? "Asia/Shanghai",
    bullJobKey: "", // will be updated after queue.add
    workspaceId: params.workspaceId ?? null,
    runtimeId: params.runtimeId ?? null,
    sessionId: params.sessionId ?? null,
  }).returning();

  const cronJob = cronJobResult[0];
  if (!cronJob) throw new Error("Failed to create cron job record");

  try {
    const job = await taskQueue.add(
      params.taskType,
      { ...taskPayload, cronJobId: cronJob.id },
      {
        repeat: {
          pattern: params.schedule.pattern,
          tz: params.schedule.timezone ?? "Asia/Shanghai",
        },
        jobId: `cron:${cronJob.id}`,
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: { age: 30 * 24 * 3600 },
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
      },
    );

    const repeatJobKey = job.repeatJobKey;
    if (!repeatJobKey) throw new Error("Failed to get repeat job key");

    await db
      .update(cronJobs)
      .set({ bullJobKey: repeatJobKey })
      .where(eq(cronJobs.id, cronJob.id));
  } catch (queueError) {
    // Queue add failed — mark as disabled so user can retry later
    // Keep the DB record for visibility instead of deleting it
    await db
      .update(cronJobs)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(cronJobs.id, cronJob.id));

    throw new Error(
      `Cron job record created but failed to schedule in queue: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
    );
  }

  return cronJob;
};

/**
 * Remove a scheduled cron job from BullMQ and disable in DB.
 */
export const removeCronJob = async (cronJobId: string, bullJobKey: string) => {
  await taskQueue.removeRepeatableByKey(bullJobKey);
  await db
    .update(cronJobs)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(cronJobs.id, cronJobId));
};

/**
 * Re-enable a disabled cron job in BullMQ.
 */
export const enableCronJob = async (cronJobId: string, _bullJobKey: string, jobData: {
  taskType: string;
  payload: Record<string, unknown>;
  cronExpression: string;
  timezone: string;
  userUuid: string;
  workspaceId?: string | null;
  runtimeId?: string | null;
  sessionId?: string | null;
}) => {
  const taskPayload: TaskPayload = {
    type: jobData.taskType,
    workspaceId: jobData.workspaceId ?? undefined,
    runtimeId: jobData.runtimeId ?? undefined,
    sessionId: jobData.sessionId ?? undefined,
    userId: jobData.userUuid,
    data: jobData.payload,
    cronJobId: cronJobId,
  };

  const job = await taskQueue.add(
    jobData.taskType,
    taskPayload,
    {
      repeat: { pattern: jobData.cronExpression, tz: jobData.timezone },
      jobId: `cron:${cronJobId}`,
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
    },
  );

  // bullJobKey may change on re-add
  const repeatJobKey = job.repeatJobKey;
  if (!repeatJobKey) throw new Error("Failed to get repeat job key");

  await db
    .update(cronJobs)
    .set({ enabled: true, bullJobKey: repeatJobKey, updatedAt: new Date() })
    .where(eq(cronJobs.id, cronJobId));
};
