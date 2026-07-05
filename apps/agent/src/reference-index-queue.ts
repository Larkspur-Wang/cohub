import { COHUB_SYSTEM_FS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { enqueueReferenceIndex, type ReferenceInput } from "@cohub/core/references";
import { env } from "./env.js";
import { logger } from "./logger.js";

const referenceIndexQueue = createBullmqQueue(COHUB_SYSTEM_FS_QUEUE, {
  redisUrl: env.BULLMQ_REDIS_URL,
  telemetryServiceName: "cohub-agent-reference-index",
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
  ).catch((error) =>
    // BullMQ retries only cover enqueued jobs; a failure here (Redis down) would
    // otherwise drop these references silently. Log so it is recoverable via
    // `backfill-resource-references --reset`.
    logger.warn("[ReferenceIndex] failed to enqueue references", { count: references.length, error }),
  );
};
