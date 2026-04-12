/**
 * Task system protocol definitions.
 * Shared between API (scheduler) and Worker (executor).
 */

/**
 * Task type identifier.
 * Open-ended — add new types as needed.
 */
export type TaskType = "echo" | string;

/**
 * Universal task payload carried by every BullMQ job.
 * Fields like workspaceId / runtimeId / sessionId are optional
 * so tasks can be scoped or global.
 */
export interface TaskPayload {
  type: TaskType;
  /** Optional: which workspace this task relates to */
  workspaceId?: string;
  /** Optional: which runtime this task relates to */
  runtimeId?: string;
  /** Optional: which session this task relates to */
  sessionId?: string;
  /** Optional: the user who owns / triggered this task */
  userId?: string;
  /** Optional: cron job that spawned this execution (set by API on enqueue) */
  cronJobId?: string;
  /** Task-specific parameters */
  data?: Record<string, unknown>;
}

/**
 * Task run status in the database.
 *
 * Flow:
 *   pending (API-enqueued only)
 *     → running (worker picked up)
 *       → completed | failed
 */
export type TaskRunStatus = "pending" | "running" | "completed" | "failed";

/**
 * Cron schedule configuration passed from the client.
 */
export interface TaskScheduleConfig {
  /** Cron expression, e.g. "0 10 * * *" */
  pattern: string;
  /** IANA timezone, defaults to "Asia/Shanghai" */
  timezone?: string;
}
