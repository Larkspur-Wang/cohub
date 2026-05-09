import type { Job } from "bullmq";
import type { TaskPayload } from "@neta-art/cohub-protocol/task";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { taskRuns } from "../db-schema.js";

export type TaskHandlerContext = {
  taskRunId: string;
};

export type TaskHandler = (
  job: Job,
  context?: TaskHandlerContext,
) => Promise<Record<string, unknown> | undefined>;

const registry = new Map<string, TaskHandler>();

/**
 * Register a task handler. Automatically wrapped with task_runs lifecycle management.
 *
 * Lifecycle:
 *   - If task_runs exists (API-enqueued → pending): update to running
 *   - If not (cron-spawned): insert as running
 *   - On success: update to completed
 *   - On failure: update to failed (then rethrow for BullMQ retry)
 */
export const registerTask = (type: string, handler: TaskHandler) => {
  const wrapped: TaskHandler = async (job) => {
    const jobId = job.id;
    if (!jobId) throw new Error("Job has no id");

    const payload = job.data as TaskPayload;
    const now = new Date();

    // UPSERT: insert if cron-spawned, or update pending → running
    const existing = await db
      .select({ id: taskRuns.id })
      .from(taskRuns)
      .where(eq(taskRuns.jobId, jobId))
      .limit(1);

    let taskRunId = existing[0]?.id ?? crypto.randomUUID();

    if (existing.length > 0) {
      // Already exists (API-enqueued with pending status)
      await db
        .update(taskRuns)
        .set({
          status: "running",
          startedAt: now,
          attemptCount: job.attemptsMade,
          updatedAt: now,
        })
        .where(eq(taskRuns.jobId, jobId));
    } else {
      // Cron-spawned — first time we see this job
      // Use onConflictDoNothing to handle retry after DB write interruption
      await db.insert(taskRuns).values({
        id: taskRunId,
        jobId,
        cronJobId: payload.cronJobId ?? null,
        taskType: job.name,
        status: "running",
        payload,
        spaceId: payload.spaceId ?? null,
        sessionId: payload.sessionId ?? null,
        userUuid: payload.userId ?? null,
        startedAt: now,
        attemptCount: job.attemptsMade,
      }).onConflictDoNothing();
    }

    try {
      const result = await handler(job, { taskRunId });

      await db
        .update(taskRuns)
        .set({
          status: "completed",
          result: result ?? null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(taskRuns.jobId, jobId));

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db
        .update(taskRuns)
        .set({
          status: "failed",
          errorMessage,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(taskRuns.jobId, jobId));

      throw error; // Rethrow so BullMQ handles retry/backoff
    }
  };

  registry.set(type, wrapped);
};

export const getTaskHandler = (type: string): TaskHandler | undefined => {
  return registry.get(type);
};

export const getRegisteredTasks = () => {
  return Array.from(registry.keys());
};
