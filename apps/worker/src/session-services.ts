import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { createSessionServices } from "@cohub/core/sessions";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";
import { config } from "./config.js";
import type { PromptTemplateService } from "./prompt-templates.js";

const AGENT_TURN_JOB_NAME = "agent_turns";

const agentTurnQueue = createBullmqQueue<{
  spaceId: string;
  sessionId: string;
  reason?: "prompt" | "steer" | "drain" | "retry" | "recovery";
  requestId?: string | null;
  trace?: Record<string, unknown>;
}>(COHUB_AGENT_TURNS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-agent-turns",
});

export function getSessionDomainServices(input: {
  promptTemplateService: PromptTemplateService;
}) {
  return createSessionServices({
    db,
    redis: redisCommandClient,
    promptTemplateService: input.promptTemplateService,
    injectTrace,
    getRequestId: () => null,
    agentTurnQueue: {
      enqueue: (job) => agentTurnQueue.add(AGENT_TURN_JOB_NAME, {
        spaceId: job.spaceId,
        sessionId: job.sessionId,
        reason: job.reason,
        requestId: job.requestId,
        trace: job.trace,
      }, {
        jobId: job.jobId ?? `agent-session-wakeup-${job.sessionId}`,
        attempts: 2,
        backoff: { type: "fixed", delay: 1000 },
        removeOnComplete: true,
        removeOnFail: defaultJobRetention.removeOnFail,
      }),
    },
    logger: console,
  });
}
