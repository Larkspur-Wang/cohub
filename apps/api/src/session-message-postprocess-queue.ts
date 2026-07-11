import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import {
  buildSessionMessagePostprocessJobId,
  SESSION_MESSAGE_POSTPROCESS_JOB,
  type SessionMessagePostprocessJobData,
} from "@cohub/protocol";
import { config } from "./config.js";

const queue = createBullmqQueue<SessionMessagePostprocessJobData>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-message-postprocess",
});

export const enqueueSessionMessagePostprocess = (input: Omit<SessionMessagePostprocessJobData, "trace">) =>
  queue.add(
    SESSION_MESSAGE_POSTPROCESS_JOB,
    { ...input, trace: injectTrace() },
    {
      jobId: buildSessionMessagePostprocessJobId(input.messageId),
      attempts: 8,
      backoff: { type: "exponential", delay: 1_000 },
      ...defaultJobRetention,
    },
  );
