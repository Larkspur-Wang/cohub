import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import type { ContentBlock } from "@cohub/protocol/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { wrapAgentTurn } from "@cohub/infra/tracing/agent";
import { runInActiveSpan, extractTrace } from "@cohub/infra/tracing/propagator";
import { getAgentTracer } from "@cohub/infra/tracing/agent";
import { getSpace, abortSessionTurn, persistAssistantMessage, persistUserMessage } from "./api.js";
import { ensureSandboxConnection } from "./sandbox-pool.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import { CohubModelRegistry } from "./runtime/model-registry.js";
import { loadRuntimeModelsConfigs } from "./runtime/models-loader.js";
import { clearCurrentSessionExecutionAuth, setCurrentSessionExecutionAuth } from "./runtime/session-execution-auth.js";
import { runWithToolExecutionContext } from "./tool-context.js";
import { loadOrCreateSessionHandle, ensurePendingUserMessage, hasSessionUserMessage, removePendingUserMessage, resetStreamState, refreshSessionHandleFileSignature, type SessionHandle } from "./session.js";
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
type RetryReason = "session_busy" | "session_locked";

const retryAttemptsByKey = new Map<string, number>();
const BUSY_RETRY_BASE_DELAY_MS = env.AGENT_BUSY_RETRY_BASE_DELAY_MS;
const BUSY_RETRY_MAX_DELAY_MS = env.AGENT_BUSY_RETRY_MAX_DELAY_MS;

function getRetryKey(data: AgentTurnJobData, reason: RetryReason) {
  return `${reason}:${data.sessionId}:${data.turnIds.join(",")}`;
}

function nextRetryDelayMs(key: string) {
  const attempt = (retryAttemptsByKey.get(key) ?? 0) + 1;
  retryAttemptsByKey.set(key, attempt);
  return Math.min(BUSY_RETRY_MAX_DELAY_MS, BUSY_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt - 1, 12));
}

function clearRetryState(data: AgentTurnJobData) {
  retryAttemptsByKey.delete(getRetryKey(data, "session_busy"));
  retryAttemptsByKey.delete(getRetryKey(data, "session_locked"));
}

async function requeueTurnJob(data: AgentTurnJobData, reason: RetryReason, job?: Job<AgentTurnJobData>, meta?: Record<string, unknown>) {
  const firstTurnId = data.turnIds[0];
  if (!firstTurnId) return { skipped: reason, retryInMs: 0, jobId: job?.id ?? null, ...meta };
  const retryKey = getRetryKey(data, reason);
  const delay = nextRetryDelayMs(retryKey);
  await enqueueAgentTurnJob(data, {
    jobId: `agent-turn-retry-${reason}-${firstTurnId}-${Math.max(1, Math.ceil(Date.now() / delay))}`,
    delay,
    removeOnComplete: true,
    removeOnFail: true,
  });
  return { skipped: reason, retryInMs: delay, jobId: job?.id ?? null, ...meta };
}

type DrainNextQueuedResult = { enqueued: boolean; turnId: string | null };

async function drainNextQueuedTurn(input: { spaceId: string; sessionId: string; reason: string }): Promise<DrainNextQueuedResult> {
  try {
    const turnId = await enqueueNextQueuedTurn({
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      enqueue: enqueueAgentTurnJob,
    });
    if (turnId) {
      logger.info(`[Agent] enqueued next queued turn sessionId=${input.sessionId} turnId=${turnId} reason=${input.reason}`);
    }
    return { enqueued: Boolean(turnId), turnId: turnId ?? null };
  } catch (error) {
    logger.warn(`[Agent] failed to enqueue next queued turn spaceId=${input.spaceId} sessionId=${input.sessionId} reason=${input.reason}:`, error);
    throw error;
  }
}

async function getModelRegistryForUser(userId: string | null | undefined) {
  const configs = await loadRuntimeModelsConfigs(userId?.trim() || null);
  const registry = new CohubModelRegistry({ configs });
  if (registry.getError()) {
    console.warn(`[Agent] Model registry warning for ${userId?.trim() || "__platform__"}:`, registry.getError());
  }
  return registry;
}

function contentBlockToImageContent(block: ContentBlock): ImageContent | null {
  if (block.type !== "image" || block.source.type !== "base64") return null;
  return {
    type: "image",
    data: block.source.data.replace(/^data:[^;,]+;base64,/, ""),
    mimeType: block.source.media_type || "application/octet-stream",
  };
}

function contentBlockToAgentContent(block: ContentBlock): { type: "text"; text: string } | ImageContent | null {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") return contentBlockToImageContent(block);
  return null;
}

function contentToAgentMessage(content: ContentBlock[], meta: Record<string, unknown> | null): AgentMessage {
  const agentContent = content.map(contentBlockToAgentContent).filter((block): block is { type: "text"; text: string } | ImageContent => Boolean(block));
  return {
    role: "user",
    content: agentContent.length > 0 ? agentContent : [{ type: "text", text: "" }],
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

type TurnUserMessage = {
  turnId: string;
  turnSeq: number;
  userMessageId: string;
  content: ContentBlock[];
  meta: Record<string, unknown>;
};

function normalizeTurnUserMeta(input: TurnUserMessage, patch?: Record<string, unknown>) {
  return {
    ...input.meta,
    ...(patch ?? {}),
    userMessageId: input.userMessageId,
    messageId: input.userMessageId,
    turnId: input.turnId,
    anchorUserMessageId: input.userMessageId,
  };
}

function setActiveTurnContext(handle: SessionHandle, input: {
  turnId: string;
  turnSeq: number;
  userMessageId: string | null;
  userMeta: Record<string, unknown> | null;
  llmRound?: number | null;
}) {
  handle.currentTurnId = input.turnId;
  handle.currentTurnSeq = input.turnSeq;
  handle.currentTurnPatchSeq = 0;
  handle.currentAssistantMessageOrdinal = null;
  handle.currentStreamMessageId = null;
  handle.currentUserMessageId = input.userMessageId;
  handle.currentUserMessageMeta = input.userMeta;
  handle.currentLlmRound = input.llmRound ?? 0;
}

function clearActiveTurnContext(handle: SessionHandle, sessionId: string) {
  clearCurrentSessionExecutionAuth(sessionId);
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

async function appendAndPersistUserMessage(input: {
  handle: SessionHandle;
  spaceId: string;
  sessionId: string;
  user: TurnUserMessage;
  meta: Record<string, unknown>;
}) {
  const message = contentToAgentMessage(input.user.content, input.meta);
  input.handle.session.agent.state.messages.push(message);
  const entryId = input.handle.sessionManager.appendMessage(message);
  (message as unknown as Record<string, unknown>).sessionEntryId = entryId;

  await persistUserMessage({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    userMessageId: input.user.userMessageId,
    turnId: input.user.turnId,
    content: input.user.content,
    meta: input.meta,
  });

  return message;
}

async function runDirectShellCommandTurn(input: {
  handle: SessionHandle;
  tools: ReturnType<typeof createSandboxCodingTools>;
  spaceId: string;
  sessionId: string;
  user: TurnUserMessage;
  command: string;
  rawText: string;
  actorUserId: string | null;
  executionToken: string | null;
  turnMetrics: { llmRoundCount: number; toolCallCount: number };
  abortSignal?: AbortSignal;
}) {
  const { user } = input;
  const userMessageId = user.userMessageId;

  const bashTool = input.tools.find((tool) => tool.name === "bash");
  if (!bashTool) throw new Error("bash tool is not available");

  const handle = input.handle;
  setActiveTurnContext(handle, {
    turnId: user.turnId,
    turnSeq: user.turnSeq,
    userMessageId,
    userMeta: user.meta,
    llmRound: 0,
  });
  handle.currentAssistantMessageOrdinal = 0;
  handle.currentStreamMessageId = `turn:${user.turnId}:assistant:0`;
  handle.currentUserMessageContent = user.content;

  setCurrentSessionExecutionAuth({
    sessionId: input.sessionId,
    actorUserId: input.actorUserId,
    executionToken: input.executionToken,
  });

  let cleanupParentAbort: (() => void) | null = null;

  try {
    const userMeta = normalizeTurnUserMeta(user, {
      intent: "shell_command",
      llm: false,
      rawText: input.rawText,
      command: input.command,
    });
    handle.currentUserMessageMeta = userMeta;
    await appendAndPersistUserMessage({
      handle,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      user,
      meta: userMeta,
    });

    const toolUseId = `direct_shell_${randomUUID()}`;
    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort();
    if (input.abortSignal?.aborted) {
      abortFromParent();
    } else {
      input.abortSignal?.addEventListener("abort", abortFromParent, { once: true });
      cleanupParentAbort = () => input.abortSignal?.removeEventListener("abort", abortFromParent);
    }
    handle.activeDirectShellCommand = { turnId: user.turnId, abortController };

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
        turnId: user.turnId,
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
    const entryId = handle.sessionManager.appendMessage(assistantMessage);
    (assistantMessage as unknown as Record<string, unknown>).sessionEntryId = entryId;

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
      turnId: user.turnId,
    });

    input.turnMetrics.toolCallCount += 1;
    removePendingUserMessage(handle, userMessageId);
  } finally {
    cleanupParentAbort?.();
    handle.activeDirectShellCommand = null;
    clearActiveTurnContext(handle, input.sessionId);
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

type PostReleaseDrain = { spaceId: string; sessionId: string; reason: string } | null;

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
    if (!lock) {
      const result = await requeueTurnJob(data, "session_locked", job);
      logger.info(`[Agent] session locked; requeued sessionId=${data.sessionId} turnIds=${data.turnIds.join(",")} retryInMs=${result.retryInMs}`);
      return result;
    }
    let activeTurn: { id: string; controller: AbortController } | null = null;
    let drainAfterRelease: PostReleaseDrain = null;

    try {
      const claim = await claimTurnBatch(data);
      if (claim.kind === "noop") {
        clearRetryState(data);
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

      clearRetryState(data);
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
        });
        drainAfterRelease = { spaceId: data.spaceId, sessionId: data.sessionId, reason: "abort_precheck" };
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

      await ensureSandboxConnection(data.spaceId);

      const turnUserMessages: TurnUserMessage[] = buildUserMessagesForBatch(batch)
        .filter((item) => Boolean(item.userMessageId))
        .map((item) => ({
          turnId: item.turnId,
          turnSeq: item.turnSeq,
          userMessageId: item.userMessageId,
          content: item.content,
          meta: item.meta,
        }));
      for (const item of turnUserMessages) {
        const meta = normalizeTurnUserMeta(item);
        ensurePendingUserMessage(handle, {
          userMessageId: item.userMessageId,
          turnId: item.turnId,
          turnSeq: item.turnSeq,
          content: item.content,
          meta,
        });
      }

      const ownerUserMessageId = batch.executionBatch.anchorUserMessageId ?? turnUserMessages.at(-1)?.userMessageId ?? null;
      const executionToken = executionAuth?.token?.trim() || null;
      const turnMetrics = { llmRoundCount: 0, toolCallCount: 0 };
      const abortController = new AbortController();
      activeTurn = { id: batch.ownerTurn.id, controller: abortController };
      setActiveAbortController(batch.ownerTurn.id, abortController);

      setActiveTurnContext(handle, {
        turnId: batch.ownerTurn.id,
        turnSeq: batch.ownerTurn.sequence,
        userMessageId: ownerUserMessageId,
        userMeta: ownerMeta,
        llmRound: 0,
      });
      resetStreamState(handle);

      const messages = turnUserMessages
        .filter((item) => !hasSessionUserMessage(handle, item.userMessageId))
        .map((item) => contentToAgentMessage(item.content, normalizeTurnUserMeta(item)));

      const directShellItem = turnUserMessages.length === 1 ? turnUserMessages[0] : null;
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
              user: directShellItem,
              command: directShellCommand.command,
              rawText: directShellCommand.rawText,
              actorUserId,
              executionToken,
              turnMetrics,
              abortSignal: abortController.signal,
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
        drainAfterRelease = { spaceId: data.spaceId, sessionId: data.sessionId, reason: "direct_shell_complete" };
        clearRetryState(data);
        return {
          ownerTurnId: batch.ownerTurn.id,
          mergedTurnIds: batch.mergedTurns.map((turn) => turn.id),
          userMessageCount: turnUserMessages.length,
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
      drainAfterRelease = { spaceId: data.spaceId, sessionId: data.sessionId, reason: "turn_complete" };
      clearRetryState(data);
      return {
        ownerTurnId: batch.ownerTurn.id,
        mergedTurnIds: batch.mergedTurns.map((turn) => turn.id),
        userMessageCount: turnUserMessages.length,
      };
    } finally {
      if (activeTurn) clearActiveAbortController(activeTurn.id, activeTurn.controller);
      await lock.release();
      if (drainAfterRelease) await drainNextQueuedTurn(drainAfterRelease);
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
