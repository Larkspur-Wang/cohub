import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { maybeEnqueueSpaceHookTask } from "@cohub/core/hooks";
import { COHUB_TASKS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { config } from "./config.js";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { dispatchRealtimeEvent } from "./channels.js";
import type { RealtimeRoom, RealtimeServerEvent } from "@cohub/protocol/realtime";
import { createLogger } from "@cohub/infra/logging";

const logger = createLogger({ serviceName: "cohub-api" });

const taskQueue = createBullmqQueue(COHUB_TASKS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-space-hooks",
});

function enqueueSpaceHookFromEvent(input: {
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

export async function dispatchSpaceDomainEvent(input: RealtimeServerEvent & {
  rooms?: RealtimeRoom[];
}) {
  await Promise.all([
    dispatchRealtimeEvent(input),
    enqueueSpaceHookFromEvent({
      id: input.id,
      type: input.type,
      timestamp: input.timestamp,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      payload: input.payload as Record<string, unknown>,
    }),
  ]);
}

export async function dispatchSpaceFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
  await Promise.all([
    dispatchSpaceDomainEvent({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "space",
      type: "space.fs.changed",
      spaceId,
      sessionId: null,
      payload,
    }),
    enqueueFsCdnWarmForChanges(spaceId, payload.changes).catch((error) => {
      logger.error("[SpaceFS] Failed to enqueue CDN prewarm:", error);
    }),
  ]);
}
