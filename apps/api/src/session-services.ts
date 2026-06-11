import { COHUB_AGENT_TURNS_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { getCurrentRequestId, getOrCreateRequestId } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { createSessionServices } from "@cohub/core/sessions";
import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { db } from "./db/index.js";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";
import { expandPromptTemplate, type LoadPromptTemplatesOptions, type ExpandedPromptTemplate } from "./prompt-templates.js";
import { ensureSpaceSandbox, recoverSpaceSandbox } from "./space-sandboxes.js";
import { getSpaceSessionById, getSpaceById } from "./space-sessions.js";
import { dispatchSessionUpdated } from "./realtime-events.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-api" });
const AGENT_TURN_JOB_NAME = "agent_turns";

export type PromptTemplateService = {
  expand(text: string, options?: LoadPromptTemplatesOptions): Promise<ExpandedPromptTemplate | null>;
};

const defaultPromptTemplateService: PromptTemplateService = {
  expand: expandPromptTemplate,
};

const agentTurnQueue = createBullmqQueue<{
  spaceId: string;
  sessionId: string;
  reason?: "prompt" | "steer" | "drain" | "retry" | "recovery";
  requestId?: string | null;
  trace?: Record<string, unknown>;
}>(COHUB_AGENT_TURNS_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-agent-turns",
});

const sandboxLifecycle = createSandboxLifecycleController({ db, infra: null });

let defaultSessionDomainServices: ReturnType<typeof createSessionServices> | null = null;

export function getSessionDomainServices(input?: {
  promptTemplateService?: PromptTemplateService;
}) {
  if (!input?.promptTemplateService && defaultSessionDomainServices) {
    return defaultSessionDomainServices;
  }

  const services = createSessionServices({
    db,
    redis: redisCommandClient,
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
          logger.warn(`[SandboxResume] failed to resume sandbox for prompt spaceId=${spaceId}:`, error);
        });
      },
    },
    injectTrace,
    getRequestId: getCurrentRequestId,
    onSessionActivityUpdated: async ({ sessionId, changed }) => {
      const session = await getSpaceSessionById(sessionId);
      if (!session) return;
      await dispatchSessionUpdated({ session, changed });
    },
    agentTurnQueue: {
      enqueue: (job) => agentTurnQueue.add(AGENT_TURN_JOB_NAME, {
        spaceId: job.spaceId,
        sessionId: job.sessionId,
        reason: job.reason,
        requestId: getOrCreateRequestId(job.requestId),
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

  if (!input?.promptTemplateService) {
    defaultSessionDomainServices = services;
  }
  return services;
}
