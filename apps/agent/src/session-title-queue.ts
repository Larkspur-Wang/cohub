import { createSessionTitleGenerationEnqueuer } from "@cohub/infra/session-title-queue";
import { env } from "./env.js";

export const enqueueSessionTitleGeneration = createSessionTitleGenerationEnqueuer({
  redisUrl: env.BULLMQ_REDIS_URL,
  telemetryServiceName: "cohub-agent-session-title",
});
