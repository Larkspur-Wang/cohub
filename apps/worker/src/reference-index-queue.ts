import { COHUB_SYSTEM_FS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { enqueueReferenceIndex, type ReferenceInput } from "@cohub/core/references";
import { config } from "./config.js";

const referenceIndexQueue = createBullmqQueue(COHUB_SYSTEM_FS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-reference-index",
});

/**
 * Enqueue references for asynchronous indexing. Never throws: reference stats
 * must never fail the behavior that produced them.
 */
export const enqueueReferences = (references: readonly ReferenceInput[]): void => {
  void enqueueReferenceIndex(
    (name, data, options) =>
      referenceIndexQueue.add(name, data, {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        ...defaultJobRetention,
        ...options,
      }),
    references,
    { trace: injectTrace() },
  ).catch(() => undefined);
};
