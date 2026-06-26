import { randomUUID } from "node:crypto";
import type { RealtimeTaskRecord } from "@cohub/protocol/realtime";
import type { TaskRunStatus } from "@cohub/protocol/task";
import { redis } from "./redis.js";

const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

const toIsoOrNull = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const toIso = (value: Date | string | null | undefined) => toIsoOrNull(value) ?? new Date().toISOString();

const toTaskRunStatus = (value: string): TaskRunStatus =>
  value === "running" || value === "completed" || value === "failed" ? value : "pending";

function toRealtimeTaskRecord(task: {
  id: string;
  jobId: string;
  cronJobId: string | null;
  taskType: string;
  status: string;
  spaceId: string | null;
  sessionId: string | null;
  turnId: string | null;
  userUuid: string | null;
  attemptCount: number;
  scheduledAt: Date | string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  errorMessage: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}): RealtimeTaskRecord {
  return {
    id: task.id,
    type: task.taskType,
    status: toTaskRunStatus(task.status),
    jobId: task.jobId,
    cronJobId: task.cronJobId,
    spaceId: task.spaceId,
    sessionId: task.sessionId,
    turnId: task.turnId,
    userId: task.userUuid,
    attemptCount: task.attemptCount,
    scheduledAt: toIsoOrNull(task.scheduledAt),
    startedAt: toIsoOrNull(task.startedAt),
    finishedAt: toIsoOrNull(task.finishedAt),
    errorMessage: task.errorMessage,
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
  };
}

export async function dispatchTaskCreated(task: Parameters<typeof toRealtimeTaskRecord>[0]) {
  const realtimeTask = toRealtimeTaskRecord(task);
  if (!realtimeTask.spaceId && !realtimeTask.userId) return;

  await redis.publish(
    REALTIME_OUTBOUND_CHANNEL,
    JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "task.created",
      spaceId: realtimeTask.spaceId,
      sessionId: realtimeTask.sessionId,
      payload: {
        task: realtimeTask,
        ...(realtimeTask.userId && !realtimeTask.spaceId ? { userId: realtimeTask.userId } : {}),
      },
    }),
  );
}
