import { COHUB_TASKS_QUEUE, createBullmqQueue } from "@cohub/infra/bullmq";
import { enqueueTaskRun, type TaskEnqueueOptions } from "@cohub/core/tasks";
import type { TaskPayload } from "@cohub/protocol/task";
import { config } from "../config.js";
import { db } from "../db.js";

const taskQueue = createBullmqQueue(COHUB_TASKS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker",
});

export const enqueueTask = (payload: TaskPayload, options?: TaskEnqueueOptions) => enqueueTaskRun({
  db,
  payload,
  options,
  enqueue: (name, taskPayload, jobOptions) => taskQueue.add(name, taskPayload, jobOptions),
});
