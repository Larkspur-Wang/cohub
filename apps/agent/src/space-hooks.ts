import { maybeEnqueueSpaceHookTask } from "@cohub/core/hooks";
import { COHUB_TASKS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { env } from "./env.js";
import { logger } from "./logger.js";

const taskQueue = createBullmqQueue(COHUB_TASKS_QUEUE, {
  redisUrl: env.BULLMQ_REDIS_URL,
  telemetryServiceName: "cohub-agent-space-hooks",
});

export function enqueueSpaceHookFromEvent(input: {
  id?: string | null;
  type: string;
  timestamp?: number;
  spaceId?: string | null;
  sessionId?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  return maybeEnqueueSpaceHookTask({
    event: input,
    enqueue: (name, payload, options) => taskQueue.add(name, payload, {
      ...defaultJobRetention,
      ...options,
    }),
  }).catch((error) => {
    logger.warn("[SpaceHooks] failed to enqueue space_hook task", {
      type: input.type,
      spaceId: input.spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
}
