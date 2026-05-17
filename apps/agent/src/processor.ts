import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { ContentBlock } from "@cohub/protocol/core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { wrapAgentTurn } from "@cohub/infra/tracing/agent";
import { runInActiveSpan, extractTrace } from "@cohub/infra/tracing/propagator";
import { getAgentTracer } from "@cohub/infra/tracing/agent";
import { getSpace, abortSessionTurn, persistAssistantMessage, persistUserMessage } from "./api.js";
import { acquireSandbox } from "./sandbox-pool.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import { CohubModelRegistry } from "./runtime/model-registry.js";
import { loadRuntimeModelsConfigs } from "./runtime/models-loader.js";
import { clearCurrentSessionExecutionAuth, setCurrentSessionExecutionAuth } from "./runtime/session-execution-auth.js";
import { runWithToolExecutionContext } from "./tool-context.js";
import { loadOrCreateSessionHandle, ensurePendingUserMessage, resetStreamState, refreshSessionHandleFileSignature, type SessionHandle } from "./session.js";
import { claimTurnBatch, buildUserMessagesForBatch, enqueueNextQueuedTurn } from "./batch.js";
import { acquireSessionLock } from "./session-lock.js";
import { enqueueAgentTurnJob, type AgentTurnJobData } from "./queue.js";
import { getAbortEvent } from "./abort.js";
import { setActiveAbortController, clearActiveAbortController } from "./active-turns.js";
import { sendOutput } from "./redis.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const sessionHandles = new Map<string, SessionHandle>();
const tools = createSandboxCodingTools();
const agentTracer = getAgentTracer();
const busyRetryAttempts = new Map<string, number>();
const BUSY_RETRY_BASE_DELAY_MS = env.AGENT_BUSY_RETRY_BASE_DELAY_MS;
const BUSY_RETRY_MAX_DELAY_MS = env.AGENT_BUSY_RETRY_MAX_DELAY_MS;

function getBusyRetryKey(data: AgentTurnJobData) {
  return `${data.sessionId}:${data.turnIds.join(",")}`;
}

function nextBusyRetryDelayMs(key: string) {
  const attempt = (busyRetryAttempts.get(key) ?? 0) + 1;
  busyRetryAttempts.set(key, attempt);
  return Math.min(BUSY_RETRY_MAX_DELAY_MS, BUSY_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 12));
}

function clearBusyRetry(data: AgentTurnJobData) {
  busyRetryAttempts.delete(getBusyRetryKey(data));
}

async function requeueTurnJob(data: AgentTurnJobData, reason: string, job?: Job<AgentTurnJobData>, meta?: Record<string, unknown>) {
  const firstTurnId = data.turnIds[0];
  if (!firstTurnId) return { skipped: reason, retryInMs: 0, jobId: job?.id ?? null, ...meta };
  const retryKey = getBusyRetryKey(data);
  const delay = reason === "session_busy" ? nextBusyRetryDelayMs(retryKey) : BUSY_RETRY_BASE_DELAY_MS;
  await enqueueAgentTurnJob(data, {
    jobId: `agent-turn-retry-${firstTurnId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    delay,
  });
  return { skipped: reason, retryInMs: delay, jobId: job?.id ?? null, ...meta };
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

function getShellCommandBlock(content: ContentBlock[]): Extract<ContentBlock, { type: "shell_command" }> | null {
  if (content.length !== 1) return null;
  const block = content[0];
  return block?.type === "shell_command" ? block : null;
}

function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    return record.content
      .map((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text"
        ? String((item as Record<string, unknown>).text ?? "")
        : "")
      .join("");
  }
  return typeof record.content === "string" ? record.content : "";
}

function formatShellCommandResultForLlm(input: {
  command: string;
  output: string;
  exitCode?: number | null;
  cancelled?: boolean;
}) {
  let text = `Ran \`${input.command}\``;
  text += input.output ? `\n\`\`\`\n${input.output}\n\`\`\`` : "\n(no output)";
  if (input.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (input.exitCode != null && input.exitCode !== 0) {
    text += `\n\nCommand exited with code ${input.exitCode}`;
  }
  return text;
}

async function runDirectShellCommandTurn(input: {
  handle: SessionHandle;
  tools: ReturnType<typeof createSandboxCodingTools>;
  spaceId: string;
  sessionId: string;
  userMessageId: string | null | undefined;
  content: ContentBlock[];
  meta: Record<string, unknown> | null | undefined;
  command: string;
  rawText: string;
  turnId: string;
  turnSeq: number;
  actorUserId: string | null;
  executionToken: string | null;
  turnMetrics: { llmRoundCount: number; toolCallCount: number };
}) {
  const userMessageId = input.userMessageId;
  if (!userMessageId) throw new Error("userMessageId is required for shell command inputs");

  const bashTool = input.tools.find((tool) => tool.name === "bash");
  if (!bashTool) throw new Error("bash tool is not available");

  const handle = input.handle;
  handle.currentTurnId = input.turnId;
  handle.currentTurnSeq = input.turnSeq;
  handle.currentTurnPatchSeq = 0;
  handle.currentAssistantMessageOrdinal = 0;
  handle.currentStreamMessageId = `turn:${input.turnId}:assistant:0`;
  handle.currentUserMessageId = userMessageId;
  handle.currentUserMessageContent = input.content;
  handle.currentUserMessageMeta = input.meta ?? null;
  handle.currentLlmRound = 0;

  setCurrentSessionExecutionAuth({
    sessionId: input.sessionId,
    actorUserId: input.actorUserId,
    executionToken: input.executionToken,
  });

  try {
    const userMeta = {
      ...(input.meta ?? {}),
      intent: "shell_command",
      llm: false,
      rawText: input.rawText,
      command: input.command,
    };
    const userMessage = {
      role: "user",
      content: input.content,
      timestamp: Date.now(),
      meta: userMeta,
    } as never;

    handle.session.agent.state.messages.push(userMessage);
    handle.sessionManager.appendMessage(userMessage);
    await persistUserMessage({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      userMessageId,
      turnId: input.turnId,
      content: input.content,
      meta: userMeta,
    });

    const toolUseId = `direct_shell_${randomUUID()}`;
    const abortController = new AbortController();
    handle.activeDirectShellCommand = { turnId: input.turnId, abortController };

    const toolUseBlock: ContentBlock = {
      type: "tool_use",
      id: toolUseId,
      name: "bash",
      input: { command: input.command },
      _meta: { direct: true, source: "shell_command", toolStatus: "running" },
    };
    let patchSeq = 0;
    let latestOutput = "";
    let publishChain = Promise.resolve();

    const publish = async (blocks: ContentBlock[], final = false) => {
      patchSeq += 1;
      handle.currentTurnPatchSeq = patchSeq;
      await sendOutput({
        type: "stream_update",
        spaceId: input.spaceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        seq: patchSeq,
        baseSeq: Math.max(0, patchSeq - 1),
        content: blocks,
        snapshotContent: blocks,
        messageId: handle.currentStreamMessageId,
        messageOrdinal: 0,
        sourceMessageId: userMessageId,
        anchorUserMessageId: userMessageId,
        timestamp: Date.now(),
        ...(final ? { turnEnd: true } : {}),
      });
    };

    await publish([toolUseBlock]);

    let exitCode: number | null | undefined;
    let cancelled = false;
    let truncated = false;
    let executionFailed = false;
    let errorMessage: string | null = null;
    try {
      const result = await bashTool.execute(
        toolUseId,
        { command: input.command } as never,
        abortController.signal,
        (partialResult: unknown) => {
          const partialText = extractToolResultText(partialResult);
          if (partialText) latestOutput = partialText;
          const partialBlocks: ContentBlock[] = [
            toolUseBlock,
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: latestOutput,
              is_error: false,
              _meta: { direct: true, source: "shell_command", partial: true, toolStatus: "running" },
            },
          ];
          publishChain = publishChain
            .then(() => publish(partialBlocks))
            .catch((error) => {
              logger.error(`[Agent] Failed to publish shell command update for session ${input.sessionId}:`, error);
            });
        },
      );
      latestOutput = extractToolResultText(result);
      const details = result && typeof result === "object" ? (result as unknown as Record<string, unknown>).details as Record<string, unknown> | undefined : undefined;
      exitCode = typeof details?.exitCode === "number" ? details.exitCode : null;
      truncated = Boolean(details?.truncation);
    } catch (error) {
      executionFailed = true;
      cancelled = abortController.signal.aborted;
      errorMessage = error instanceof Error ? error.message : String(error);
      latestOutput = latestOutput || errorMessage;
      exitCode = null;
      if (!cancelled) {
        logger.error(`[Agent] Direct shell command failed sessionId=${input.sessionId}:`, error);
      }
    }

    const isError = executionFailed || cancelled || (exitCode != null && exitCode !== 0);
    const finalToolUseBlock: ContentBlock = {
      ...toolUseBlock,
      _meta: { direct: true, source: "shell_command", toolStatus: isError ? "failed" : "done" },
    };
    const finalToolResultBlock: ContentBlock = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content: latestOutput,
      is_error: isError,
      _meta: {
        direct: true,
        source: "shell_command",
        partial: false,
        toolStatus: isError ? "failed" : "done",
        exitCode: exitCode ?? null,
        cancelled,
        truncated,
        executionFailed,
        ...(errorMessage ? { errorMessage } : {}),
      },
    };
    const assistantContent: ContentBlock[] = [finalToolUseBlock, finalToolResultBlock];
    await publishChain;
    await publish(assistantContent, true);

    const model = handle.session.agent.state.model;
    const assistantMessage = {
      role: "assistant",
      content: assistantContent,
      timestamp: Date.now(),
      stopReason: cancelled ? "aborted" : "end",
      provider: model.provider,
      model: model.id,
      meta: {
        messageKind: "shell_command_result",
        executionKind: "shell_command_result",
        llm: false,
        command: input.command,
        rawText: input.rawText,
        exitCode: exitCode ?? null,
        cancelled,
        truncated,
        executionFailed,
        ...(errorMessage ? { errorMessage } : {}),
        llmContextText: formatShellCommandResultForLlm({
          command: input.command,
          output: latestOutput,
          exitCode,
          cancelled,
        }),
      },
    } as never;
    handle.session.agent.state.messages.push(assistantMessage);
    handle.sessionManager.appendMessage(assistantMessage);

    await persistAssistantMessage({
      spaceId: input.spaceId,
      spaceSessionId: input.sessionId,
      userMessageId,
      event: {
        type: "turn_end",
        message: assistantMessage as Record<string, unknown>,
        toolResults: [{
          toolCallId: toolUseId,
          toolName: "bash",
          input: { command: input.command },
          content: latestOutput,
          isError,
          _meta: finalToolResultBlock._meta,
        }],
      },
      userId: input.actorUserId,
      turnId: input.turnId,
    });

    input.turnMetrics.toolCallCount += 1;
  } finally {
    handle.activeDirectShellCommand = null;
    clearCurrentSessionExecutionAuth(input.sessionId);
    handle.currentLlmRound = null;
    handle.currentTurnId = null;
    handle.currentTurnSeq = null;
    handle.currentTurnPatchSeq = null;
    handle.currentAssistantMessageOrdinal = null;
    handle.currentStreamMessageId = null;
    handle.currentUserMessageId = null;
    handle.currentUserMessageMeta = null;
    handle.currentUserMessageContent = null;
    handle.lastActiveAt = Date.now();
  }
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
      if (claim.kind === "noop") {
        clearBusyRetry(data);
        return { skipped: "noop" };
      }
      if (claim.kind === "busy") {
        const result = await requeueTurnJob(data, "session_busy", job, {
          activeTurnId: claim.activeTurnId,
          activeStatus: claim.activeStatus,
          activeUpdatedAt: claim.activeUpdatedAt?.toISOString() ?? null,
        });
        if ((result.retryInMs ?? 0) >= BUSY_RETRY_MAX_DELAY_MS) {
          logger.warn(`[Agent] session busy retry delayed sessionId=${data.sessionId} turnIds=${data.turnIds.join(",")} activeTurnId=${claim.activeTurnId} delayMs=${result.retryInMs}`);
        }
        return result;
      }

      clearBusyRetry(data);
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

      const directShellItem = userMessages.length === 1 ? userMessages[0] : null;
      const directShellCommand = directShellItem ? getShellCommandBlock(directShellItem.content) : null;
      if (directShellItem && directShellCommand) {
        await wrapAgentTurn(agentTracer, {
          action: "prompt",
          mode: "prompt",
          spaceId: data.spaceId,
          sessionId: data.sessionId,
          turnId: batch.ownerTurn.id,
          turnSeq: batch.ownerTurn.sequence,
          userMessageId: directShellItem.userMessageId,
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
            logger.debug(`[Agent] shell-command:start sessionId=${data.sessionId}`);
            await runDirectShellCommandTurn({
              handle,
              tools,
              spaceId: data.spaceId,
              sessionId: data.sessionId,
              userMessageId: directShellItem.userMessageId,
              content: directShellItem.content,
              meta: directShellItem.meta,
              command: directShellCommand.command,
              rawText: directShellCommand.rawText,
              turnId: batch.ownerTurn.id,
              turnSeq: batch.ownerTurn.sequence,
              actorUserId,
              executionToken,
              turnMetrics,
            });
            logger.debug(`[Agent] shell-command:end sessionId=${data.sessionId}`);
          });
          turnSpan.setAttribute("agent.llm_round_count", 0);
          turnSpan.setAttribute("agent.tool_count", turnMetrics.toolCallCount);
          turnSpan.setAttribute("agent.outcome", "ok");
        });

        await handle.persistenceChain.catch(() => undefined);
        await handle.sessionManager.flush().catch((error) => console.warn(`[Agent] failed to flush session ${data.sessionId}:`, error));
        await refreshSessionHandleFileSignature(handle);
        await enqueueNextQueuedTurn({ spaceId: data.spaceId, sessionId: data.sessionId, enqueue: enqueueAgentTurnJob });
        clearBusyRetry(data);
        return {
          ownerTurnId: batch.ownerTurn.id,
          mergedTurnIds: batch.mergedTurns.map((turn) => turn.id),
          userMessageCount: userMessages.length,
        };
      }

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
                handle.activeDirectShellCommand?.abortController.abort();
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
      await refreshSessionHandleFileSignature(handle);
      await enqueueNextQueuedTurn({ spaceId: data.spaceId, sessionId: data.sessionId, enqueue: enqueueAgentTurnJob });
      clearBusyRetry(data);
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

export const __test = {
  getShellCommandBlock,
  formatShellCommandResultForLlm,
};

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
