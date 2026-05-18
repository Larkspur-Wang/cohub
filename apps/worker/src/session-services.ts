import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue } from "@cohub/infra/bullmq";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { createSessionServices } from "@cohub/core/sessions";
import type { ExecutionGrantService } from "@cohub/core/security";
import { db } from "./db.js";
import { redisCommandClient } from "./redis.js";
import { config } from "./config.js";
import type { PromptTemplateService } from "./prompt-templates.js";

const AGENT_TURN_JOB_NAME = "agent_turns";

const agentTurnQueue = createBullmqQueue<{
  spaceId: string;
  sessionId: string;
  turnIds: string[];
  executionAuth?: { token: string; expiresAt: number } | null;
  requestId?: string | null;
  trace?: Record<string, unknown>;
}>(COHUB_AGENT_TURNS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-agent-turns",
});

export function getSessionDomainServices(input: {
  executionGrantService: ExecutionGrantService;
  promptTemplateService: PromptTemplateService;
}) {
  return createSessionServices({
    db,
    redis: redisCommandClient,
    executionGrantService: input.executionGrantService,
    promptTemplateService: input.promptTemplateService,
    injectTrace,
    getRequestId: () => null,
    agentTurnQueue: {
      enqueue: (job) => agentTurnQueue.add(AGENT_TURN_JOB_NAME, {
        spaceId: job.spaceId,
        sessionId: job.sessionId,
        turnIds: job.turnIds,
        executionAuth: job.executionAuth,
        requestId: job.requestId,
        trace: job.trace,
      }, {
        jobId: job.jobId,
        attempts: 2,
        backoff: { type: "fixed", delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 10_000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      }),
    },
    logger: console,
  });
}
