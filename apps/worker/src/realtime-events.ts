import { randomUUID } from "node:crypto";
import type { RealtimeTaskRecord } from "@cohub/protocol/realtime";
import type { TaskRunStatus } from "@cohub/protocol/task";
import { recomputeSpaceWsUsers } from "@cohub/core/spaces";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";

const REALTIME_OUTBOUND_CHANNEL = "pubsub:realtime:outbound";

const toIsoOrNull = (value: Date | string | null | undefined) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
};

const toIso = (value: Date | string | null | undefined) => toIsoOrNull(value) ?? new Date().toISOString();

const toTaskRunStatus = (value: string): TaskRunStatus =>
  value === "running" || value === "completed" || value === "failed" ? value : "pending";

export const toRealtimeTaskRecord = (task: {
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
}): RealtimeTaskRecord => ({
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
});

async function publishTaskEvent(input: {
  type: "task.created" | "task.updated";
  task: Parameters<typeof toRealtimeTaskRecord>[0];
  changed?: string[];
}) {
  const task = toRealtimeTaskRecord(input.task);
  const targetUserIds = task.spaceId
    ? await recomputeSpaceWsUsers({ db, redis: redisCommandClient, spaceId: task.spaceId }).catch(() => [] as string[])
    : task.userId
      ? [task.userId]
      : [];
  if (!task.spaceId && targetUserIds.length === 0) return;

  await redisCommandClient.publish(
    REALTIME_OUTBOUND_CHANNEL,
    JSON.stringify({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: input.type,
      spaceId: task.spaceId,
      sessionId: task.sessionId,
      payload: {
        task,
        ...(input.changed ? { changed: input.changed } : {}),
        ...(targetUserIds.length > 0 ? { targetUserIds } : {}),
      },
    }),
  );
}

export const dispatchTaskCreated = (task: Parameters<typeof toRealtimeTaskRecord>[0]) =>
  publishTaskEvent({ type: "task.created", task });

export const dispatchTaskUpdated = (input: {
  task: Parameters<typeof toRealtimeTaskRecord>[0];
  changed: string[];
}) => publishTaskEvent({ type: "task.updated", task: input.task, changed: input.changed });
