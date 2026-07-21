import { randomUUID } from "node:crypto";
import type { SpaceFsChangedPayload } from "@cohub/protocol/fs";
import { maybeEnqueueSpaceHookTask } from "@cohub/infra/space-hooks";
import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultCriticalJobOptions } from "@cohub/infra/bullmq";
import { config } from "./config.js";
import { enqueueFsCdnWarmForChanges } from "./space-fs-cdn-prewarm.js";
import { dispatchRealtimeEvent } from "./channels.js";
import type { RealtimeRoom, RealtimeServerEvent } from "@cohub/protocol/realtime";
import { createLogger } from "@cohub/infra/logging";
import { redisCommandClient } from "./redis.js";

const logger = createLogger({ serviceName: "cohub-api" });

const systemQueue = createBullmqQueue(COHUB_SYSTEM_QUEUE, {
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
    redis: redisCommandClient,
    enqueue: (name, payload, options) => systemQueue.add(name, payload, {
      ...defaultCriticalJobOptions,
      ...options,
    }),
  }).catch((error) => {
    logger.warn("[SpaceHooks] failed to enqueue space_hook.dispatch", {
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
