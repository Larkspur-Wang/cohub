import { QueueEvents } from "bullmq";
import {
  COHUB_AGENT_TURNS_QUEUE,
  createBullmqConnectionOptions,
} from "@cohub/infra/bullmq";
import {
  createAgentTurnsQueue,
  enqueueAgentRunCommandJob,
  type AgentRunCommandJobResult,
} from "@cohub/infra/agent-queue";
import {
  buildHookRunCommand,
  buildSpaceHookEnv,
  buildSpaceHookPromptText,
  invalidateSpaceHooksCache,
  loadSpaceHookDefinitions,
  mergeSpaceHookExecutionEnv,
  shouldInvalidateSpaceHooksCache,
  spaceHookMatchesEvent,
  type SpaceHookDefinition,
  type SpaceHookRunResult,
} from "@cohub/core/hooks";
import { SPACE_HOOK_TASK_TYPE, type SpaceHookEventEnvelope } from "@cohub/protocol";
import type { TaskPayload } from "@cohub/protocol/task";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { spaceSessions, spaces, taskRuns } from "@cohub/db";
import { assignLabelsToSession, assignSessionSourceSystemLabel } from "@cohub/core/labels";
import { createLogger } from "@cohub/infra/logging";
import { config } from "../config.js";
import { db } from "../db.js";
import { getSpaceWorkspaceDir } from "../git.js";
import { redisCommandClient } from "../redis.js";
import { getPromptTemplateService } from "../prompt-templates.js";
import { getSkillService } from "../skills.js";
import { getSessionDomainServices } from "../session-services.js";
import { registerTask } from "./registry.js";

const logger = createLogger({ serviceName: "cohub-worker" });
const agentQueue = createAgentTurnsQueue(config.bullmqRedisUrl, "cohub-worker-space-hook");
let agentQueueEvents: QueueEvents | null = null;
let agentQueueEventsReady: Promise<void> | null = null;
const DEFAULT_TIMEOUT_SECS = 10 * 60;
const MAX_OUTPUT_CHARS = 32 * 1024;

async function getAgentQueueEvents() {
  if (!agentQueueEvents) {
    agentQueueEvents = new QueueEvents(COHUB_AGENT_TURNS_QUEUE, {
      connection: createBullmqConnectionOptions(config.bullmqRedisUrl),
    });
    agentQueueEventsReady = agentQueueEvents.waitUntilReady().then(() => undefined);
  }
  await agentQueueEventsReady;
  return agentQueueEvents;
}

const sessionPromptService = getSessionDomainServices({
  promptTemplateService: getPromptTemplateService(),
  skillService: getSkillService(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getJobId(job: Job) {
  if (!job.id) throw new Error("Task job has no id");
  return job.id;
}

function clampOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated …`,
    truncated: true,
  };
}

function parseEvent(data: Record<string, unknown>): SpaceHookEventEnvelope {
  const event = isRecord(data.event) ? data.event : null;
  if (!event) throw new Error("space_hook task requires data.event");
  const id = asString(event.id);
  const type = asString(event.type);
  const spaceId = asString(event.spaceId);
  if (!id || !type || !spaceId) throw new Error("space_hook event is missing id/type/spaceId");
  return {
    id,
    type,
    timestamp: typeof event.timestamp === "number" ? event.timestamp : Date.now(),
    spaceId,
    sessionId: asString(event.sessionId),
    payload: isRecord(event.payload) ? event.payload : {},
  };
}

async function runPromptHook(input: {
  spaceId: string;
  userId: string;
  taskRunId: string;
  hook: SpaceHookDefinition;
  event: SpaceHookEventEnvelope;
  eventActorUserId: string | null;
  hookEnv: Record<string, string>;
}): Promise<SpaceHookRunResult> {
  if (input.hook.action !== "prompt" || !input.hook.prompt) {
    return {
      path: input.hook.path,
      action: "prompt",
      status: "failed",
      error: "prompt action is missing prompt definition",
    };
  }

  const startedAt = Date.now();
  const prompt = input.hook.prompt;
  let sessionId = prompt.sessionId?.trim() || asString(input.event.sessionId) || null;

  // Validate session belongs to this space to prevent cross-space injection.
  if (sessionId) {
    const [session] = await db
      .select({ spaceId: spaceSessions.spaceId })
      .from(spaceSessions)
      .where(eq(spaceSessions.id, sessionId))
      .limit(1);
    if (!session || session.spaceId !== input.spaceId) {
      return {
        path: input.hook.path,
        action: "prompt",
        status: "failed",
        durationMs: Date.now() - startedAt,
        error: `session ${sessionId} does not belong to space ${input.spaceId}`,
      };
    }
  }

  if (!sessionId) {
    const created = await sessionPromptService.registerCronjobSession(input.spaceId, {
      source: "space_hook",
      title: prompt.title ?? `Hook ${input.hook.path}`,
      userUuid: input.userId,
    });
    sessionId = created.id;
    await assignSessionSourceSystemLabel({ db, spaceId: input.spaceId, sessionId, source: "space_hook" }).catch((error) => {
      logger.warn("[SpaceHooks] failed to assign source label", error);
    });
  }

  if (prompt.labelRefs && prompt.labelRefs.length > 0) {
    await assignLabelsToSession({ db, spaceId: input.spaceId, sessionId, labelIds: prompt.labelRefs, userId: input.userId }).catch((error) => {
      logger.warn("[SpaceHooks] failed to assign label refs", error);
    });
  }

  try {
    const result = await sessionPromptService.submitPrompt({
      spaceId: input.spaceId,
      sessionId,
      userId: input.userId,
      clientMessageId: `space-hook:${input.taskRunId}:${input.hook.path}`,
      content: [{
        type: "text",
        text: buildSpaceHookPromptText({
          promptText: prompt.text,
          env: input.hookEnv,
        }),
      }],
      source: "space_hook",
      model: prompt.model ?? null,
      provider: prompt.provider ?? null,
      accessMode: prompt.accessMode ?? "full_access",
      intent: prompt.intent ?? "followup",
      // User-declared hook env only — system COHUB_HOOK_* rides on context.env.
      env: input.hook.env ?? null,
      context: {
        kind: "space_hook",
        taskRunId: input.taskRunId,
        hookPath: input.hook.path,
        eventId: input.event.id,
        eventType: input.event.type,
        ...(input.eventActorUserId ? { eventActorUserId: input.eventActorUserId } : {}),
        env: input.hookEnv,
      },
    });

    return {
      path: input.hook.path,
      action: "prompt",
      status: "completed",
      durationMs: Date.now() - startedAt,
      sessionId,
      turnId: result.turnId ?? null,
      userMessageId: result.userMessageId ?? null,
    };
  } catch (error) {
    logger.warn("[SpaceHooks] prompt hook failed", {
      path: input.hook.path,
      spaceId: input.spaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      path: input.hook.path,
      action: "prompt",
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runCommandHook(input: {
  spaceId: string;
  userId: string;
  taskRunId: string;
  hook: SpaceHookDefinition;
  event: SpaceHookEventEnvelope;
  hookEnv: Record<string, string>;
}): Promise<SpaceHookRunResult> {
  if (input.hook.action !== "run" || !input.hook.run) {
    return {
      path: input.hook.path,
      action: "run",
      status: "failed",
      error: "run action is missing run command",
    };
  }

  const startedAt = Date.now();
  const command = buildHookRunCommand(input.hook.run);
  const timeout = input.hook.timeoutSecs ?? DEFAULT_TIMEOUT_SECS;
  // BullMQ custom jobIds reject ":"; keep a stable, path-derived suffix instead.
  const childTaskRunId = `${input.taskRunId}__${input.hook.path.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;

  try {
    const agentJob = await enqueueAgentRunCommandJob(agentQueue, {
      spaceId: input.spaceId,
      sessionId: input.event.sessionId ?? null,
      taskRunId: childTaskRunId,
      command,
      cwd: "/workspace",
      timeout,
      userId: input.userId,
      env: mergeSpaceHookExecutionEnv({
        userEnv: input.hook.env,
        hookEnv: input.hookEnv,
      }),
    });
    const queueEvents = await getAgentQueueEvents();
    const result = await agentJob.waitUntilFinished(
      queueEvents,
      (timeout + 60) * 1000,
    ) as AgentRunCommandJobResult;
    const output = clampOutput(result.output ?? "");
    const failed = (result.exitCode ?? 1) !== 0
      || result.termination?.reason === "timed_out"
      || result.termination?.reason === "aborted";
    return {
      path: input.hook.path,
      action: "run",
      status: failed ? "failed" : "completed",
      exitCode: result.exitCode,
      durationMs: result.durationMs ?? Date.now() - startedAt,
      output: output.text,
      truncated: output.truncated || result.truncated,
      taskRunId: childTaskRunId,
      ...(failed
        ? {
            error: result.termination?.message
              ?? (result.exitCode == null ? "hook command failed" : `exit code ${result.exitCode}`),
          }
        : {}),
    };
  } catch (error) {
    return {
      path: input.hook.path,
      action: "run",
      status: "failed",
      durationMs: Date.now() - startedAt,
      taskRunId: childTaskRunId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectChangedPaths(payload: Record<string, unknown>) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const paths: string[] = [];
  for (const change of changes) {
    if (!isRecord(change)) continue;
    if (typeof change.path === "string" && change.path.trim()) paths.push(change.path);
    if (typeof change.oldPath === "string" && change.oldPath.trim()) paths.push(change.oldPath);
  }
  return paths;
}

async function resolveSpaceOwnerUserId(spaceId: string) {
  const [space] = await db
    .select({ userUuid: spaces.userUuid })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return space?.userUuid?.trim() || null;
}

async function resolveTaskRunRecordId(jobId: string) {
  const [run] = await db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(eq(taskRuns.jobId, jobId))
    .limit(1);
  return run?.id ?? null;
}

async function updateTaskRunOwner(jobId: string, userId: string) {
  await db.update(taskRuns).set({
    userUuid: userId,
    updatedAt: new Date(),
  }).where(eq(taskRuns.jobId, jobId)).catch(() => undefined);
}

registerTask(SPACE_HOOK_TASK_TYPE, async (job, context) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  if (!spaceId) throw new Error("spaceId is required for space_hook task");

  const data = isRecord(payload.data) ? payload.data : {};
  const event = parseEvent(data);
  const eventActorUserId = asString(data.eventActorUserId);
  const jobId = getJobId(job);
  // Prefer the DB task_runs.id so clients can resolve via GET /api/tasks/:id.
  const taskRunId = context?.taskRunId
    ?? await resolveTaskRunRecordId(jobId)
    ?? jobId;

  if (event.type === "space.fs.changed") {
    const paths = collectChangedPaths(event.payload);
    if (shouldInvalidateSpaceHooksCache(paths)) {
      await invalidateSpaceHooksCache({ spaceId, redis: redisCommandClient });
    }
  }

  const ownerUserId = await resolveSpaceOwnerUserId(spaceId);
  if (!ownerUserId) {
    return {
      eventId: event.id,
      eventType: event.type,
      hooks: [] as SpaceHookRunResult[],
      definitionsCount: 0,
      skipped: "missing_space_owner",
    };
  }

  await updateTaskRunOwner(jobId, ownerUserId);

  const loaded = await loadSpaceHookDefinitions({
    spaceId,
    workspaceDir: getSpaceWorkspaceDir(spaceId),
    redis: redisCommandClient,
  });
  const definitions = loaded.definitions;

  const matched: SpaceHookDefinition[] = [];
  const skipped: SpaceHookRunResult[] = [];
  for (const definition of definitions) {
    const match = spaceHookMatchesEvent(definition, event);
    if (match.matched) {
      matched.push(definition);
      continue;
    }
    skipped.push({
      path: definition.path,
      action: definition.action,
      status: "skipped",
      reason: match.reason ?? "not_matched",
    });
  }

  // Per-hook try/catch already isolates failures; never throw here so BullMQ
  // does not retry and re-execute successful sibling hooks.
  const executed = await Promise.all(
    matched.map((definition) => {
      const hookEnv = buildSpaceHookEnv({
        event,
        hookPath: definition.path,
        taskRunId,
        eventActorUserId,
        executionUserId: ownerUserId,
      });
      return definition.action === "prompt"
        ? runPromptHook({
            spaceId,
            userId: ownerUserId,
            taskRunId,
            hook: definition,
            event,
            eventActorUserId,
            hookEnv,
          })
        : runCommandHook({
            spaceId,
            userId: ownerUserId,
            taskRunId,
            hook: definition,
            event,
            hookEnv,
          });
    }),
  );

  const hooks = [...skipped, ...executed];
  const failed = hooks.filter((item) => item.status === "failed");
  if (failed.length > 0) {
    logger.warn("[SpaceHooks] hook failures recorded in result", {
      spaceId,
      eventId: event.id,
      eventType: event.type,
      failures: failed.map((item) => ({ path: item.path, error: item.error })),
    });
  }

  return {
    eventId: event.id,
    eventType: event.type,
    hooks,
    definitionsCount: definitions.length,
    cache: loaded.cache,
  };
});
