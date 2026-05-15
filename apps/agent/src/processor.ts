import type { Job } from "bullmq";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { wrapAgentTurn } from "@cohub/tracing/agent";
import { runInActiveSpan, extractTrace } from "@cohub/tracing/propagator";
import { getAgentTracer } from "@cohub/tracing/agent";
import { getSpace, abortSessionTurn } from "./api.js";
import { acquireSandbox } from "./sandbox-pool.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import { CohubModelRegistry } from "./runtime/model-registry.js";
import { loadRuntimeModelsConfigs } from "./runtime/models-loader.js";
import { clearCurrentSessionExecutionAuth } from "./runtime/session-execution-auth.js";
import { runWithToolExecutionContext } from "./tool-context.js";
import { loadOrCreateSessionHandle, ensurePendingUserMessage, resetStreamState, type SessionHandle } from "./session.js";
import { claimTurnBatch, buildUserMessagesForBatch, enqueueNextQueuedTurn } from "./batch.js";
import { acquireSessionLock } from "./session-lock.js";
import { enqueueAgentTurnJob, type AgentTurnJobData } from "./queue.js";
import { getAbortEvent } from "./abort.js";
import { setActiveAbortController, clearActiveAbortController } from "./active-turns.js";

const sessionHandles = new Map<string, SessionHandle>();
const tools = createSandboxCodingTools();
const agentTracer = getAgentTracer();
const RETRY_DELAY_MS = 1000;

async function requeueTurnJob(data: AgentTurnJobData, reason: string, job?: Job<AgentTurnJobData>) {
  const firstTurnId = data.turnIds[0];
  if (!firstTurnId) return { skipped: reason };
  await enqueueAgentTurnJob(data, {
    jobId: `agent-turn-retry:${firstTurnId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    delay: RETRY_DELAY_MS,
  });
  return { skipped: reason, retryInMs: RETRY_DELAY_MS, jobId: job?.id ?? null };
}

async function getModelRegistryForUser(userId: string | null | undefined) {
  const configs = await loadRuntimeModelsConfigs(userId?.trim() || null);
  const registry = new CohubModelRegistry({ configs });
  if (registry.getError()) {
    console.warn(`[Agent] Model registry warning for ${userId?.trim() || "__platform__"}:`, registry.getError());
  }
  return registry;
}

function contentToAgentMessage(content: ContentBlock[], meta: Record<string, unknown> | null): AgentMessage {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
    meta: meta ?? null,
  } as unknown as AgentMessage;
}

async function prepareHandle(input: {
  spaceId: string;
  sessionId: string;
  ownerUserId: string | null;
  requestedModel?: { provider: string; id: string };
}) {
  const modelRegistry = await getModelRegistryForUser(input.ownerUserId);
  const handle = await loadOrCreateSessionHandle({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    modelRegistry,
    tools,
    model: input.requestedModel,
    sessionHandles,
  });

  const requested = input.requestedModel;
  if (requested) {
    const currentModel = handle.session.agent.state.model;
    if (!(currentModel.provider === requested.provider && currentModel.id === requested.id)) {
      const target = handle.session.modelRegistry.find(requested.provider, requested.id);
      if (target) await handle.session.setModel(target);
    }
  }

  return handle;
}

function resolveRequestedModel(ownerMeta: Record<string, unknown>) {
  const provider = typeof ownerMeta.provider === "string" && ownerMeta.provider.trim() ? ownerMeta.provider.trim() : null;
  const model = typeof ownerMeta.model === "string" && ownerMeta.model.trim() ? ownerMeta.model.trim() : null;
  return provider && model ? { provider, id: model } : undefined;
}

function resolveActorUserId(ownerMeta: Record<string, unknown>) {
  return typeof ownerMeta.userId === "string" && ownerMeta.userId.trim() ? ownerMeta.userId.trim() : null;
}

export async function processAgentTurnJob(job: Job<AgentTurnJobData>) {
  const data = job.data;
  const parentCtx = extractTrace((data.trace ?? data) as Record<string, unknown>);
  return runInActiveSpan(agentTracer, "agent.turn_job.process", {
    attributes: {
      "cohub.space_id": data.spaceId,
      "cohub.session_id": data.sessionId,
      "job.id": job.id ?? "",
      "job.attempt": job.attemptsMade,
    },
  }, parentCtx, async () => {
    const lock = await acquireSessionLock(data.sessionId);
    if (!lock) return { skipped: "session_locked" };
    let sandboxLease: { release: () => void } | null = null;
    let activeTurn: { id: string; controller: AbortController } | null = null;

    try {
      const claim = await claimTurnBatch(data);
      if (claim.kind === "noop") return { skipped: "noop" };
      if (claim.kind === "busy") {
        return requeueTurnJob(data, "session_busy", job);
      }

      const { batch } = claim;
      const ownerMeta = (batch.ownerTurn.meta && typeof batch.ownerTurn.meta === "object" && !Array.isArray(batch.ownerTurn.meta)
        ? batch.ownerTurn.meta as Record<string, unknown>
        : {});
      const actorUserId = resolveActorUserId(ownerMeta);
      const executionAuth = (ownerMeta.executionAuth && typeof ownerMeta.executionAuth === "object" && !Array.isArray(ownerMeta.executionAuth)
        ? ownerMeta.executionAuth as { token?: string; expiresAt?: number }
        : null) ?? data.executionAuth ?? null;
      const abortEvent = await getAbortEvent(batch.ownerTurn.id);
      if (abortEvent) {
        await abortSessionTurn({
          spaceId: data.spaceId,
          sessionId: data.sessionId,
          turnId: batch.ownerTurn.id,
          actorUserId,
        }).catch(() => undefined);
        return { skipped: "abort_requested", turnId: batch.ownerTurn.id };
      }
      const spaceInfo = await getSpace({ spaceId: data.spaceId }).catch(() => null);
      const ownerUserId = spaceInfo?.space?.userUuid?.trim() || null;
      const handle = await prepareHandle({
        spaceId: data.spaceId,
        sessionId: data.sessionId,
        ownerUserId,
        requestedModel: resolveRequestedModel(ownerMeta),
      });

      sandboxLease = await acquireSandbox(data.spaceId);

      const userMessages = buildUserMessagesForBatch(batch);
      for (const item of userMessages) {
        if (!item.userMessageId) continue;
        ensurePendingUserMessage(handle, {
          userMessageId: item.userMessageId,
          turnId: item.turnId,
          turnSeq: item.turnSeq,
          content: item.content,
          meta: item.meta,
        });
      }

      const ownerUserMessageId = batch.executionBatch.anchorUserMessageId ?? userMessages.at(-1)?.userMessageId ?? null;
      const executionToken = executionAuth?.token?.trim() || null;
      const turnMetrics = { llmRoundCount: 0, toolCallCount: 0 };
      const abortController = new AbortController();
      activeTurn = { id: batch.ownerTurn.id, controller: abortController };
      setActiveAbortController(batch.ownerTurn.id, abortController);

      handle.currentTurnId = batch.ownerTurn.id;
      handle.currentTurnSeq = batch.ownerTurn.sequence;
      handle.currentTurnPatchSeq = 0;
      handle.currentAssistantMessageOrdinal = null;
      handle.currentStreamMessageId = null;
      handle.currentUserMessageId = ownerUserMessageId;
      handle.currentUserMessageMeta = ownerMeta;
      handle.currentLlmRound = 0;
      resetStreamState(handle);

      const messages = userMessages
        .filter((item) => item.userMessageId && !handle.sessionManager.buildSessionContext().messages.some((message) => {
          const meta = (message as unknown as { meta?: unknown }).meta;
          return meta && typeof meta === "object" && !Array.isArray(meta) && (meta as Record<string, unknown>).messageId === item.userMessageId;
        }))
        .map((item) => contentToAgentMessage(item.content, item.meta));

      if (messages.length === 0) {
        console.info(`[Agent] batch has no new user messages; continuing ownerTurn=${batch.ownerTurn.id}`);
      }

      await wrapAgentTurn(agentTracer, {
        action: "prompt",
        mode: "prompt",
        spaceId: data.spaceId,
        sessionId: data.sessionId,
        turnId: batch.ownerTurn.id,
        turnSeq: batch.ownerTurn.sequence,
        userMessageId: ownerUserMessageId,
        modelProvider: handle.session.agent.state.model.provider,
        modelId: handle.session.agent.state.model.id,
        isResumedSession: handle.sessionManager.buildSessionContext().messages.length > 0,
      }, async (turnSpan) => {
        await runWithToolExecutionContext({
          spaceId: data.spaceId,
          sessionId: data.sessionId,
          turnId: batch.ownerTurn.id,
          turnSeq: batch.ownerTurn.sequence,
          llmRound: 0,
          actorUserId,
          executionToken,
          metrics: turnMetrics,
        }, async () => {
          try {
            if (abortController.signal.aborted) throw new Error("aborted");
            const abortPromise = new Promise<never>((_, reject) => {
              abortController.signal.addEventListener("abort", () => {
                handle.session.abort().catch(() => undefined);
                reject(new Error("aborted"));
              }, { once: true });
            });
            if (messages.length > 0) {
              await Promise.race([handle.session.promptMessages(messages), abortPromise]);
            } else {
              await Promise.race([
                (async () => {
                  await handle.session.agent.continue();
                  await handle.session.waitForIdle();
                })(),
                abortPromise,
              ]);
            }
          } catch (error) {
            if (abortController.signal.aborted || (error instanceof Error && error.message === "aborted")) {
              await handle.session.abort().catch(() => undefined);
              await abortSessionTurn({
                spaceId: data.spaceId,
                sessionId: data.sessionId,
                turnId: batch.ownerTurn.id,
                actorUserId,
              }).catch(() => undefined);
              await handle.persistenceChain.catch(() => undefined);
              return;
            }
            throw error;
          }
        });
        turnSpan.setAttribute("agent.llm_round_count", turnMetrics.llmRoundCount);
        turnSpan.setAttribute("agent.tool_count", turnMetrics.toolCallCount);
        turnSpan.setAttribute("agent.outcome", "ok");
      });

      await handle.persistenceChain.catch(() => undefined);
      await handle.sessionManager.flush().catch((error) => console.warn(`[Agent] failed to flush session ${data.sessionId}:`, error));
      await enqueueNextQueuedTurn({ spaceId: data.spaceId, sessionId: data.sessionId, enqueue: enqueueAgentTurnJob });
      return {
        ownerTurnId: batch.ownerTurn.id,
        mergedTurnIds: batch.mergedTurns.map((turn) => turn.id),
        userMessageCount: userMessages.length,
      };
    } finally {
      if (activeTurn) clearActiveAbortController(activeTurn.id, activeTurn.controller);
      sandboxLease?.release();
      await lock.release();
    }
  });
}

export function getActiveSessionHandles() {
  return sessionHandles;
}

export async function disposeAllSessionHandles() {
  for (const handle of sessionHandles.values()) {
    try {
      await handle.sessionManager.flush().catch(() => undefined);
      await handle.persistenceChain.catch(() => undefined);
      clearCurrentSessionExecutionAuth(handle.sessionId);
      handle.session.dispose();
    } catch (error) {
      console.error(`[Agent] failed to dispose session ${handle.sessionId}:`, error);
    }
  }
  sessionHandles.clear();
}
