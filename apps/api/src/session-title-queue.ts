import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import {
  SESSION_TITLE_GENERATE_JOB,
  type SessionTitleGenerateJobData,
} from "@cohub/protocol";
import { config } from "./config.js";

const queue = createBullmqQueue<SessionTitleGenerateJobData>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-session-title",
});

export const enqueueSessionTitleGeneration = (
  input: Omit<SessionTitleGenerateJobData, "trace">,
) => queue.add(
  SESSION_TITLE_GENERATE_JOB,
  { ...input, trace: injectTrace() },
  {
    // Deduplicate only for the job lifecycle; BullMQ releases this key on completion or failure.
    deduplication: { id: `session-title-${input.sessionId}` },
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    ...defaultJobRetention,
    removeOnComplete: true,
  },
);
