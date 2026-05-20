import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue } from "@cohub/infra/bullmq";
import { getCurrentRequestId, getOrCreateRequestId } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { createSessionServices } from "@cohub/core/sessions";
import { createExecutionGrantService, type ExecutionGrantService } from "@cohub/core/security";
import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { db } from "./db/index.js";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";
import { expandPromptTemplate, type LoadPromptTemplatesOptions, type ExpandedPromptTemplate } from "./prompt-templates.js";
import { ensureSpaceSandbox, recoverSpaceSandbox } from "./space-sandboxes.js";
import { getSpaceById } from "./space-sessions.js";

const AGENT_TURN_JOB_NAME = "agent_turns";

export type PromptTemplateService = {
  expand(text: string, options?: LoadPromptTemplatesOptions): Promise<ExpandedPromptTemplate | null>;
};

const defaultExecutionGrantService = createExecutionGrantService({
  signingKey: config.executionGrantSigningKey,
});

const defaultPromptTemplateService: PromptTemplateService = {
  expand: expandPromptTemplate,
};

const agentTurnQueue = createBullmqQueue<{
  spaceId: string;
  sessionId: string;
  turnIds: string[];
  executionAuth?: { token: string; expiresAt: number } | null;
  requestId?: string | null;
  trace?: Record<string, unknown>;
}>(COHUB_AGENT_TURNS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-agent-turns",
});

const sandboxLifecycle = createSandboxLifecycleController({ db });

let defaultSessionDomainServices: ReturnType<typeof createSessionServices> | null = null;

export function getSessionDomainServices(input?: {
  executionGrantService?: ExecutionGrantService;
  promptTemplateService?: PromptTemplateService;
}) {
  if (!input?.executionGrantService && !input?.promptTemplateService && defaultSessionDomainServices) {
    return defaultSessionDomainServices;
  }

  const services = createSessionServices({
    db,
    redis: redisCommandClient,
    executionGrantService: input?.executionGrantService ?? defaultExecutionGrantService,
    promptTemplateService: input?.promptTemplateService ?? defaultPromptTemplateService,
    sandboxRecovery: {
      maybeRecoverForPrompt: async ({ spaceId, userId, source }) => {
        const sandbox = await sandboxLifecycle.getSandbox(spaceId);
        if (sandbox && (sandbox.status === "running" || sandbox.status === "ready" || sandbox.status === "provisioning")) return;
        const space = await getSpaceById(spaceId);
        if (!space) return;
        if (!sandbox) {
          await ensureSpaceSandbox({ spaceId, status: "pending", runtimeStatus: "unknown" });
        }
        void recoverSpaceSandbox({
          spaceId,
          userUuid: userId,
          ownerUserUuid: space.userUuid,
          reason: sandbox?.status === "error" ? "auto_recover" : "auto_resume",
          source,
          verify: false,
        }).catch((error) => {
          console.warn(`[SandboxResume] failed to resume sandbox for prompt spaceId=${spaceId}:`, error);
        });
      },
    },
    injectTrace,
    getRequestId: getCurrentRequestId,
    agentTurnQueue: {
      enqueue: (job) => agentTurnQueue.add(AGENT_TURN_JOB_NAME, {
        spaceId: job.spaceId,
        sessionId: job.sessionId,
        turnIds: job.turnIds,
        executionAuth: job.executionAuth,
        requestId: getOrCreateRequestId(job.requestId),
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

  if (!input?.executionGrantService && !input?.promptTemplateService) {
    defaultSessionDomainServices = services;
  }
  return services;
}
