import {
  SESSION_TITLE_GENERATE_JOB,
  type SessionTitleGenerateJobData,
} from "@cohub/protocol";
import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "./bullmq/index.js";
import { injectTrace } from "./tracing/propagator.js";

export function createSessionTitleGenerationEnqueuer(input: {
  redisUrl: string;
  telemetryServiceName: string;
}) {
  const queue = createBullmqQueue<SessionTitleGenerateJobData>(COHUB_SYSTEM_QUEUE, input);
  return (data: Omit<SessionTitleGenerateJobData, "trace">) => queue.add(
    SESSION_TITLE_GENERATE_JOB,
    { ...data, trace: injectTrace() },
    {
      // BullMQ releases lifecycle deduplication on completion or failure, allowing later re-drive.
      deduplication: { id: `session-title-${data.sessionId}` },
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      ...defaultJobRetention,
      removeOnComplete: true,
    },
  );
}
