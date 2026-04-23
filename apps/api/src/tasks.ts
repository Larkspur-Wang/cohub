import { Queue, type JobsOptions } from "bullmq";
import { eq } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { cronJobs, taskRuns } from "./db/schema-v2.js";
import type { TaskPayload, TaskScheduleConfig } from "@cohub/protocol/task";

const QUEUE_NAME = "cohub-tasks";

const connection = { url: config.bullmqRedisUrl };

export const taskQueue = new Queue(QUEUE_NAME, { connection });

export const SUPPORTED_TASK_TYPES = new Set<string>(["send_message", "save_checkpoint", "create_space"]);

export const enqueueTask = async (
  payload: TaskPayload,
  opts?: JobsOptions & { scheduledAt?: Date | null },
) => {
  const taskRunId = crypto.randomUUID();

  const job = await taskQueue.add(payload.type, payload, {
    ...opts,
    jobId: taskRunId,
  });

  await db.insert(taskRuns).values({
    id: taskRunId,
    jobId: taskRunId,
    taskType: payload.type,
    spaceId: payload.spaceId ?? null,
    sessionId: payload.sessionId ?? null,
    userUuid: payload.userId ?? null,
    cronJobId: payload.cronJobId ?? null,
    status: "pending",
    payload,
    scheduledAt: opts?.scheduledAt ?? (opts?.delay ? new Date(Date.now() + opts.delay) : null),
  });

  return { job, taskRunId };
};

export const createCronJob = async (params: {
  userId: string;
  title: string;
  taskType: string;
  payload: Record<string, unknown>;
  schedule: TaskScheduleConfig;
  spaceId?: string | null;
  sessionId?: string | null;
}) => {
  const taskPayload: TaskPayload = {
    type: params.taskType,
    spaceId: params.spaceId ?? undefined,
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
    bullJobKey: "",
    spaceId: params.spaceId ?? null,
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

    const [createdJob] = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, cronJob.id))
      .limit(1);
    if (!createdJob) throw new Error("Failed to load cron job record after scheduling");

    return createdJob;
  } catch (queueError) {
    await db
      .update(cronJobs)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(cronJobs.id, cronJob.id));

    throw new Error(
      `Cron job record created but failed to schedule in queue: ${queueError instanceof Error ? queueError.message : String(queueError)}`,
    );
  }
};

export const removeCronJob = async (cronJobId: string, bullJobKey: string) => {
  if (bullJobKey) {
    await taskQueue.removeRepeatableByKey(bullJobKey);
  }
  await db
    .update(cronJobs)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(cronJobs.id, cronJobId));
};

export const disableCronJob = async (cronJobId: string, bullJobKey: string) => {
  if (bullJobKey) {
    await taskQueue.removeRepeatableByKey(bullJobKey);
  }
  await db
    .update(cronJobs)
    .set({ enabled: false, updatedAt: new Date() })
    .where(eq(cronJobs.id, cronJobId));
};

export const enableCronJob = async (cronJobId: string, bullJobKey: string, jobData: {
  taskType: string;
  payload: Record<string, unknown>;
  cronExpression: string;
  timezone: string;
  userUuid: string;
  spaceId?: string | null;
  sessionId?: string | null;
}) => {
  if (bullJobKey) {
    await taskQueue.removeRepeatableByKey(bullJobKey).catch(() => undefined);
  }

  const taskPayload: TaskPayload = {
    type: jobData.taskType,
    spaceId: jobData.spaceId ?? undefined,
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

  const repeatJobKey = job.repeatJobKey;
  if (!repeatJobKey) throw new Error("Failed to get repeat job key");

  await db
    .update(cronJobs)
    .set({ enabled: true, bullJobKey: repeatJobKey, updatedAt: new Date() })
    .where(eq(cronJobs.id, cronJobId));

  const [enabledJob] = await db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.id, cronJobId))
    .limit(1);
  if (!enabledJob) throw new Error("Failed to load enabled cron job");

  return enabledJob;
};
