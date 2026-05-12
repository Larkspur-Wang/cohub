import { extractTrace, runInActiveSpan } from "@cohub/tracing/propagator";
import { getAgentTracer, wrapAgentTurn } from "@cohub/tracing/agent";
import { randomUUID } from "node:crypto";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { SessionStreamError } from "@neta-art/cohub-protocol/realtime";
import type { SandboxHeartbeat } from "@cohub/agent-sandbox-protocol";

import "./tracing.js";

import {
  env,
} from "./env.js";
import {
  closeOwnershipRedis,
  getSessionOwner,
  releaseSessionOwner,
  renewSessionOwner,
  SESSION_OWNER_LEASE_MS,
  startAgentInstanceHeartbeatLoop,
  updateSpaceRuntime,
} from "./ownership.js";
import {
  closeRedisConnections,
  extractContentImages,
  extractContentText,
  listenForInput,
  recoverProcessingQueueOnStartup,
  sendOutput,
} from "./redis.js";
import { abortSessionTurn, getSpace, getSpaceSandbox, persistAssistantMessage, persistUserMessage } from "./api.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import {
  disconnectSandboxWsClient,
  startSandboxWsClient,
  waitForSandboxConnection,
} from "./sandbox/ws-client.js";
import { clearCurrentSessionExecutionAuth, setCurrentSessionExecutionAuth } from "./runtime/session-execution-auth.js";
import {
  getSessionKey,
  loadOrCreateSessionHandle,
  type SessionHandle,
} from "./session.js";
import { CohubModelRegistry } from "./runtime/model-registry.js";
import { loadRuntimeModelsConfigs } from "./runtime/models-loader.js";
import { refreshUserEnv } from "./runtime/env-cache.js";

import {
  getAgentPlatformConfigPath,
  getAgentSessionFilePath,
  getAgentSpaceSessionsPath,
} from "./runtime/paths.js";
import { SessionManager } from "./runtime/local-session-manager.js";
import { runWithToolExecutionContext } from "./tool-context.js";
import { logger } from "./logger.js";
const LOCAL_SANDBOX_SPACE_ID = process.env.LOCAL_SANDBOX_SPACE_ID?.trim() || null;
const LOCAL_SANDBOX_WS_URL = process.env.LOCAL_SANDBOX_WS_URL?.trim() || null;

type NormalizedSandboxStatus = "provisioning" | "ready" | "degraded" | "error";

let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();
let agentHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ownerRenewTimer: ReturnType<typeof setInterval> | null = null;
const SESSION_IDLE_EVICTION_MS = 5 * 60 * 1000;
const sessionTurnCounters = new Map<string, number>();

function normalizeSandboxStatus(status: string): NormalizedSandboxStatus {
  return status === "ready" || status === "busy"
    ? "ready"
    : status === "degraded"
      ? "degraded"
      : status === "error"
        ? "error"
        : "provisioning";
}

function toRuntimeSandboxStatus(status: NormalizedSandboxStatus): "idle" | "ready" | "error" {
  // "degraded" maps to "ready" because sandbox functions are usable;
  // the setup failure detail is carried via the error field instead.
  return status === "ready" || status === "degraded" ? "ready" : status === "error" ? "error" : "idle";
}

async function syncSandboxHeartbeat(spaceId: string, message: SandboxHeartbeat) {
  const normalized = normalizeSandboxStatus(message.status);
  const setup = message.metadata?.setup;
  if (normalized === "degraded" && setup) {
    console.warn(`[Agent] sandbox degraded spaceId=${spaceId} setup exitCode=${setup.exitCode} duration=${setup.duration} error=${setup.error ?? "unknown"}`);
  }
  await updateSpaceRuntime({
    spaceId,
    status: toRuntimeSandboxStatus(normalized),
    sandboxId: message.sandboxId,
    error: normalized === "error"
      ? `sandbox heartbeat reported ${message.status}`
      : normalized === "degraded"
        ? setup
          ? `sandbox setup.sh failed (exitCode=${setup.exitCode}, error=${setup.error ?? "unknown"})`
          : "sandbox setup.sh failed (no details)"
        : null,
  }).catch(() => undefined);
}

async function syncSandboxConnectionState(input: {
  spaceId: string;
  status: NormalizedSandboxStatus;
  reason: string;
}) {
  await updateSpaceRuntime({
    spaceId: input.spaceId,
    status: toRuntimeSandboxStatus(input.status),
    error: input.reason,
  }).catch(() => undefined);
}

async function disposeSessionHandle(handle: SessionHandle, reason: string) {
  const current = sessionHandles.get(handle.sessionKey);
  if (current !== handle) return;

  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
    handle.idleTimer = null;
  }

  console.warn(`[Agent] Disposing session ${handle.sessionId}: ${reason}`);
  try {
    await handle.sessionManager.flush().catch((error) => {
      console.error(`[Agent] Failed to flush session ${handle.sessionId}:`, error);
    });
    await handle.persistenceChain.catch(() => undefined);
    clearCurrentSessionExecutionAuth(handle.sessionId);
    handle.session.dispose();
  } catch (error) {
    console.error(`[Agent] Failed to dispose session ${handle.sessionId}:`, error);
  } finally {
    sessionHandles.delete(handle.sessionKey);
    sessionTurnCounters.delete(handle.sessionKey);
  }

  try {
    await releaseSessionOwner(handle.spaceId, handle.sessionId, handle.ownerEpoch);
  } catch (error) {
    console.error(`[Agent] Failed to release session owner ${handle.sessionId}:`, error);
  }

  if (!Array.from(sessionHandles.values()).some((item) => item.spaceId === handle.spaceId)) {
    disconnectSandboxWsClient(handle.spaceId, `no active sessions for space ${handle.spaceId}`);
  }
}

function scheduleSessionIdleEviction(handle: SessionHandle) {
  handle.lastActiveAt = Date.now();
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  logger.info(`[Session] idle:scheduled sessionId=${handle.sessionId} in=${SESSION_IDLE_EVICTION_MS}ms`);
  handle.idleTimer = setTimeout(() => {
    void disposeSessionHandle(handle, "idle eviction");
  }, SESSION_IDLE_EVICTION_MS);
}

async function shutdown(exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  try {
    for (const handle of sessionHandles.values()) {
      try {
        await disposeSessionHandle(handle, "shutdown");
      } catch (error) {
        console.error(
          `[Agent] Failed to dispose session ${handle.sessionId}:`,
          error,
        );
      }
    }
    sessionHandles.clear();
  } catch (error) {
    console.error("[Agent] Failed to dispose session handles on shutdown:", error);
  }

  try {
    if (ownerRenewTimer) clearInterval(ownerRenewTimer);
    if (agentHeartbeatTimer) clearInterval(agentHeartbeatTimer);
  } catch (error) {
    console.error("[Agent] Failed to clear heartbeat timers:", error);
  }

  try {
    await closeOwnershipRedis();
  } catch (error) {
    console.error("[Agent] Failed to close ownership Redis connection:", error);
  }

  try {
    await closeRedisConnections();
  } catch (error) {
    console.error("[Agent] Failed to close Redis connections:", error);
  }

  process.exit(exitCode);
}

async function resolveSandboxWsUrl(spaceId: string): Promise<string> {
  if (LOCAL_SANDBOX_SPACE_ID && LOCAL_SANDBOX_WS_URL && spaceId === LOCAL_SANDBOX_SPACE_ID) {
    return LOCAL_SANDBOX_WS_URL;
  }

  const response = await getSpaceSandbox({ spaceId });
  const sandbox = response?.sandbox;
  const meta = (sandbox?.meta as Record<string, unknown> | null) ?? null;
  const podIp = typeof meta?.podIp === "string" ? meta.podIp.trim() : "";
  if (!podIp) {
    throw new Error(`sandbox is not ready for requests yet: missing podIp for ${spaceId}`);
  }
  return `ws://${podIp}:8788/sandbox`;
}

async function ensureSandboxWsConnected(spaceId: string) {
  const wsUrl = await resolveSandboxWsUrl(spaceId);

  await startSandboxWsClient({
    spaceId,
    wsUrl,
    hooks: {
      onHeartbeat: (message) => syncSandboxHeartbeat(spaceId, message),
      onDisconnected: ({ reason }) => {
        if (Array.from(sessionHandles.values()).some((handle) => handle.spaceId === spaceId)) {
          void syncSandboxConnectionState({
            spaceId,
            status: "provisioning",
            reason: reason ?? "sandbox disconnected",
          });
        }
      },
      onConnectionError: ({ error }) => {
        void syncSandboxConnectionState({
          spaceId,
          status: "provisioning",
          reason: error.message,
        });
      },
    },
  });
  await waitForSandboxConnection(spaceId);
}

function startOwnerRenewLoop() {
  if (ownerRenewTimer) return;
  ownerRenewTimer = setInterval(() => {
    for (const handle of sessionHandles.values()) {
      void renewSessionOwner(handle.spaceId, handle.sessionId, handle.ownerEpoch).then((ok: boolean) => {
        if (!ok) {
          void disposeSessionHandle(handle, `session ownership lost at epoch ${handle.ownerEpoch}`);
        }
      }).catch((error: unknown) => {
        console.error(`[Agent] Failed to renew session ownership for ${handle.sessionId}:`, error);
      });
    }
  }, Math.max(1000, Math.floor(SESSION_OWNER_LEASE_MS / 4)));
}

async function verifyInputOwnership(inputEntry: { spaceId: string; sessionId?: string | null; expectedOwnerId: string; expectedEpoch: number }) {
  if (!inputEntry.sessionId) return false;
  if (inputEntry.expectedOwnerId !== env.AGENT_INSTANCE_ID) return false;
  const lease = await getSessionOwner(inputEntry.spaceId, inputEntry.sessionId);
  if (!lease) return false;
  if (lease.ownerId !== env.AGENT_INSTANCE_ID) return false;
  if (lease.epoch !== inputEntry.expectedEpoch) return false;
  if (lease.leaseUntil <= Date.now()) return false;
  return true;
}

function nextTurnSequence(sessionKey: string) {
  const next = (sessionTurnCounters.get(sessionKey) ?? 0) + 1;
  sessionTurnCounters.set(sessionKey, next);
  return next;
}

async function runInSessionOperation<T>(handle: SessionHandle, fn: () => Promise<T>): Promise<T> {
  const previous = handle.operationChain.catch((error) => {
    console.error(`[Agent] Previous session operation failed for ${handle.sessionId}:`, error);
  });
  let resolveCurrent!: () => void;
  handle.operationChain = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    resolveCurrent();
  }
}

export const __test = {
  runInSessionOperation,
};

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

async function enqueueStreamingSteerAndWait(input: {
  handle: SessionHandle;
  sessionId: string;
  text: string;
  images: ReturnType<typeof extractContentImages>;
  ack: () => Promise<void>;
  reject: (reason: string) => Promise<void>;
}) {
  if (!input.handle.session.isStreaming) {
    const inFlightDrain = input.handle.steerDrainPromise;
    if (inFlightDrain) {
      await inFlightDrain;
    }
    logger.debug(`[Agent] steer:fallback-to-prompt sessionId=${input.sessionId}`);
    await input.handle.session.prompt(input.text, {
      images: input.images,
    });
    logger.debug(`[Agent] ack input sessionId=${input.sessionId}`);
    await input.ack();
    input.handle.lastActiveAt = Date.now();
    scheduleSessionIdleEviction(input.handle);
    return;
  }

  const waiter = new Promise<void>((resolve) => {
    input.handle.pendingSteerCompletions.push({
      ack: input.ack,
      reject: input.reject,
      done: resolve,
    });
  });

  input.handle.session.enqueueSteer(input.text, input.images);

  if (!input.handle.steerDrainPromise) {
    input.handle.steerDrainPromise = (async () => {
      try {
        logger.debug(`[Agent] steer:drain:start sessionId=${input.handle.sessionId}`);
        await input.handle.session.waitForIdle();
        logger.debug(`[Agent] steer:drain:end sessionId=${input.handle.sessionId}`);
        while (input.handle.pendingSteerCompletions.length > 0) {
          const completions = input.handle.pendingSteerCompletions.splice(
            0,
            input.handle.pendingSteerCompletions.length,
          );
          for (const completion of completions) {
            await completion.ack();
            completion.done();
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        while (input.handle.pendingSteerCompletions.length > 0) {
          const completions = input.handle.pendingSteerCompletions.splice(
            0,
            input.handle.pendingSteerCompletions.length,
          );
          for (const completion of completions) {
            await completion.reject(reason);
            completion.done();
          }
        }
      } finally {
        input.handle.steerDrainPromise = null;
        input.handle.lastActiveAt = Date.now();
        if (!input.handle.session.isStreaming) {
          scheduleSessionIdleEviction(input.handle);
        }
      }
    })();
  }

  await waiter;
}

async function waitForCurrentStreamingInput(handle: SessionHandle) {
  if (!handle.session.isStreaming) return;
  const inFlightDrain = handle.steerDrainPromise;
  if (inFlightDrain) {
    await inFlightDrain;
    return;
  }
  handle.steerDrainPromise = (async () => {
    try {
      logger.debug(`[Agent] typed-input:drain:start sessionId=${handle.sessionId}`);
      await handle.session.waitForIdle();
      logger.debug(`[Agent] typed-input:drain:end sessionId=${handle.sessionId}`);
    } finally {
      handle.steerDrainPromise = null;
      handle.lastActiveAt = Date.now();
      if (!handle.session.isStreaming) {
        scheduleSessionIdleEviction(handle);
      }
    }
  })();
  await handle.steerDrainPromise;
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
  ack: () => Promise<void>;
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

    let result: unknown;
    let exitCode: number | null | undefined;
    let cancelled = false;
    let truncated = false;
    let executionFailed = false;
    let errorMessage: string | null = null;
    try {
      result = await bashTool.execute(
        toolUseId,
        { command: input.command },
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
              console.error(`[Agent] Failed to publish shell command update for session ${input.sessionId}:`, error);
            });
        },
      );
      latestOutput = extractToolResultText(result);
      const details = result && typeof result === "object" ? (result as Record<string, unknown>).details as Record<string, unknown> | undefined : undefined;
      exitCode = typeof details?.exitCode === "number" ? details.exitCode : null;
      truncated = Boolean(details?.truncation);
    } catch (error) {
      executionFailed = true;
      cancelled = abortController.signal.aborted;
      errorMessage = error instanceof Error ? error.message : String(error);
      latestOutput = latestOutput || errorMessage;
      exitCode = null;
      if (!cancelled) {
        console.error(`[Agent] Direct shell command failed sessionId=${input.sessionId}:`, error);
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
    await input.ack();
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
    scheduleSessionIdleEviction(handle);
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

async function main() {
  logger.info(`[Agent] Starting instance: ${env.AGENT_INSTANCE_ID}`);
  logger.info(`[Agent] Workspace root: ${env.WORKSPACE_ROOT}`);
  logger.info(`[Agent] Sessions root: ${env.SESSIONS_DIR}`);
  logger.info(`[Agent] Platform config root: ${env.PLATFORM_CONFIG_ROOT}`);
  logger.info(`[Agent] Platform config dir: ${getAgentPlatformConfigPath()}`);
  logger.info("[Agent] Build features:", {
    env: env.ENV,
    agentInstanceId: env.AGENT_INSTANCE_ID,
    localSandboxSpaceId: LOCAL_SANDBOX_SPACE_ID,
    localSandboxWsUrl: LOCAL_SANDBOX_WS_URL,
    agentVersion: env.AGENT_VERSION || null,
    internalApiBaseUrl:
      env.ENV === "prod"
        ? "http://cohub-api.cohub.svc.cluster.local:8787"
        : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787",
    sessionOwnershipManagedByAgent: true,
    multiSessionRestore: true,
  });

  agentHeartbeatTimer = startAgentInstanceHeartbeatLoop();
  startOwnerRenewLoop();
  await recoverProcessingQueueOnStartup();

  const tools = createSandboxCodingTools();

  logger.info("[Agent] Listening for owner-routed input.");

  const agentTracer = getAgentTracer();

  await listenForInput((inputEntry, _rawMessage, ack, reject, rawParsed) => {
    logger.debug("[Agent] Received input from Redis:", {
      action: inputEntry.action,
      spaceId: inputEntry.spaceId,
      sessionId: inputEntry.sessionId ?? null,
      contentBlocks: Array.isArray((inputEntry as { content?: unknown }).content) ? (inputEntry as { content: unknown[] }).content.length : undefined,
    });

    // Extract trace context from the message (injected by API)
    const parentCtx = extractTrace(rawParsed);

    return runInActiveSpan(agentTracer, "agent.input.consume", {
      attributes: {
        "agent.action": inputEntry.action,
        "cohub.space_id": inputEntry.spaceId,
        "cohub.session_id": inputEntry.sessionId ?? "",
      },
    }, parentCtx, async () => {
      try {
        if (!inputEntry.sessionId) {
          throw new Error("sessionId is required for session-owned input");
        }

        const ownershipOk = await verifyInputOwnership(inputEntry);
        if (!ownershipOk) {
          throw new Error(`ownership mismatch for session=${inputEntry.sessionId}, expectedOwner=${inputEntry.expectedOwnerId}, instance=${env.AGENT_INSTANCE_ID}, expectedEpoch=${inputEntry.expectedEpoch}`);
        }

        if (inputEntry.action === "fork_session") {
          const parentSessionFile = getAgentSessionFilePath(inputEntry.spaceId, inputEntry.parentSessionId);
          const childSessionFile = getAgentSessionFilePath(inputEntry.spaceId, inputEntry.sessionId);
          const parentManager = await SessionManager.open(parentSessionFile, getAgentSpaceSessionsPath(inputEntry.spaceId));
          const branchFile = await parentManager.createBranchedSession(inputEntry.anchorEntryId, { id: inputEntry.sessionId, filePath: childSessionFile, parentSession: parentSessionFile });
          if (!branchFile) throw new Error("Failed to create forked session file");
          await ack();
          return;
        }

        if (inputEntry.action === "prompt") {
          await ensureSandboxWsConnected(inputEntry.spaceId);

          const sessionId = inputEntry.sessionId;
          if (!sessionId) {
            throw new Error("sessionId is required for prompt inputs");
          }

          const meta = (inputEntry as { meta?: Record<string, unknown> | null }).meta;
          let spaceOwnerUserId = sessionHandles.get(getSessionKey(inputEntry.spaceId, sessionId))?.spaceOwnerUserId ?? null;
          if (!spaceOwnerUserId) {
            const spaceInfo = await getSpace({ spaceId: inputEntry.spaceId }).catch((error) => {
              console.warn(`[Agent] Failed to resolve space owner for ${inputEntry.spaceId}; falling back to platform config`, error);
              return null;
            });
            spaceOwnerUserId = spaceInfo?.space?.userUuid?.trim() || null;
          }
          const modelRegistry = await getModelRegistryForUser(spaceOwnerUserId);
          const requestedProvider = meta?.provider as string | undefined;
          const requestedModel = meta?.model as string | undefined;
          const requestedModelInput = (requestedProvider && requestedModel)
            ? { provider: requestedProvider, id: requestedModel }
            : undefined;

          const handle = await loadOrCreateSessionHandle({
            spaceId: inputEntry.spaceId,
            sessionId,
            modelRegistry,
            tools,
            model: requestedModelInput,
            sessionHandles,
          });

          const content = inputEntry.content as ContentBlock[];
          const userMessageId = inputEntry.userMessageId;
          const executionAuth = (inputEntry as { executionAuth?: { token?: string; expiresAt?: number } | null }).executionAuth ?? null;
          const executionToken = typeof executionAuth?.token === "string" && executionAuth.token.trim()
            ? executionAuth.token.trim()
            : null;
          const actorUserId = typeof meta?.userId === "string" && meta.userId.trim()
            ? meta.userId.trim()
            : null;

          const runPromptTurn = async () => {
            handle.ownerEpoch = inputEntry.expectedEpoch;
            handle.lastActiveAt = Date.now();
            if (handle.idleTimer) {
              clearTimeout(handle.idleTimer);
              handle.idleTimer = null;
            }

            if (!handle.onIdle) {
              handle.onIdle = (idleHandle) => {
                scheduleSessionIdleEviction(idleHandle);
              };
            }

            await refreshUserEnv(inputEntry.spaceId).catch((error: unknown) => {
              console.warn(`[Agent] Failed to refresh env before turn for ${inputEntry.spaceId}: ${error instanceof Error ? error.message : String(error)}`);
            });

            const currentModel = handle.session.agent.state.model;
            if (requestedProvider && requestedModel && currentModel) {
              if (!(currentModel.provider === requestedProvider && currentModel.id === requestedModel)) {
                const targetModel = handle.session.modelRegistry.find(requestedProvider, requestedModel);
                if (targetModel) {
                  logger.debug(
                    `[Agent] Switching model from ${currentModel.provider}/${currentModel.id} to ${requestedProvider}/${requestedModel}`,
                  );
                  await handle.session.setModel(targetModel);
                } else {
                  console.warn(
                    `[Agent] Requested model ${requestedProvider}/${requestedModel} not found, keeping current model`,
                  );
                }
              }
            }

            const sessionKey = getSessionKey(inputEntry.spaceId, sessionId);
            const turnSeq = nextTurnSequence(sessionKey);
            const turnId = typeof meta?.turnId === "string" ? meta.turnId : randomUUID();

            const turnMetrics = { llmRoundCount: 0, toolCallCount: 0 };
            const shellCommand = getShellCommandBlock(content);
            if (shellCommand) {
              const mode = handle.session.isStreaming ? "steer" : "prompt";
              await wrapAgentTurn(agentTracer, {
                action: inputEntry.action,
                mode,
                spaceId: inputEntry.spaceId,
                sessionId,
                turnId,
                turnSeq,
                userMessageId,
                modelProvider: handle.session.agent.state.model.provider,
                modelId: handle.session.agent.state.model.id,
                isResumedSession: handle.sessionManager.buildSessionContext().messages.length > 0,
              }, async (turnSpan) => {
                await waitForCurrentStreamingInput(handle);
                await runWithToolExecutionContext({
                  spaceId: inputEntry.spaceId,
                  sessionId,
                  turnId,
                  turnSeq,
                  llmRound: 0,
                  actorUserId,
                  executionToken,
                  metrics: turnMetrics,
                }, async () => {
                  logger.debug(`[Agent] shell-command:start sessionId=${sessionId}`);
                  await runDirectShellCommandTurn({
                    handle,
                    tools,
                    spaceId: inputEntry.spaceId,
                    sessionId,
                    userMessageId,
                    content,
                    meta,
                    command: shellCommand.command,
                    rawText: shellCommand.rawText,
                    turnId,
                    turnSeq,
                    actorUserId,
                    executionToken,
                    turnMetrics,
                    ack,
                  });
                  logger.debug(`[Agent] shell-command:end sessionId=${sessionId}`);
                });
                turnSpan.setAttribute("agent.llm_round_count", 0);
                turnSpan.setAttribute("agent.tool_count", turnMetrics.toolCallCount);
                turnSpan.setAttribute("agent.outcome", "ok");
              });
              return;
            }

            if (userMessageId) {
              handle.pendingUserMessages.push({
                userMessageId,
                turnId,
                turnSeq,
                content,
                meta: meta ?? null,
              });
              handle.pendingExecutionAuths.push({
                actorUserId,
                executionToken,
              });
            }
            const mode = handle.session.isStreaming ? "steer" : "prompt";
            const text = extractContentText(content);
            const images = extractContentImages(content);

            await wrapAgentTurn(agentTracer, {
              action: inputEntry.action,
              mode,
              spaceId: inputEntry.spaceId,
              sessionId,
              turnId,
              turnSeq,
              userMessageId,
              modelProvider: handle.session.agent.state.model.provider,
              modelId: handle.session.agent.state.model.id,
              isResumedSession: handle.sessionManager.buildSessionContext().messages.length > 0,
            }, async (turnSpan) => {
              if (!handle.session.isStreaming) {
                handle.currentLlmRound = 0;
              }
              if (handle.session.isStreaming) {
                logger.debug(
                  `[Agent] Session ${sessionId} is streaming, using steer for new message`,
                );
                await runWithToolExecutionContext({
                  spaceId: inputEntry.spaceId,
                  sessionId,
                  turnId,
                  turnSeq,
                  llmRound: 0,
                  actorUserId,
                  executionToken,
                  metrics: turnMetrics,
                }, async () => {
                  logger.debug(`[Agent] steer:start sessionId=${sessionId}`);
                  await enqueueStreamingSteerAndWait({
                    handle,
                    sessionId,
                    text,
                    images,
                    ack,
                    reject,
                  });
                  logger.debug(`[Agent] steer:end sessionId=${sessionId}`);
                });
              } else {
                logger.debug(
                  `[Agent] Session ${sessionId} is idle, using prompt for new message`,
                );
                await runWithToolExecutionContext({
                  spaceId: inputEntry.spaceId,
                  sessionId,
                  turnId,
                  turnSeq,
                  llmRound: 0,
                  actorUserId,
                  executionToken,
                  metrics: turnMetrics,
                }, async () => {
                  logger.debug(`[Agent] prompt:start sessionId=${sessionId}`);
                  await handle.session.prompt(text, {
                    images,
                  });
                  logger.debug(`[Agent] prompt:end sessionId=${sessionId}`);
                });
              }

              turnSpan.setAttribute("agent.llm_round_count", turnMetrics.llmRoundCount);
              turnSpan.setAttribute("agent.tool_count", turnMetrics.toolCallCount);
              turnSpan.setAttribute("agent.outcome", "ok");
              handle.currentLlmRound = turnMetrics.llmRoundCount;
            });

            if (mode === "prompt") {
              logger.debug(`[Agent] ack input sessionId=${sessionId}`);
              await ack();
              handle.lastActiveAt = Date.now();
              scheduleSessionIdleEviction(handle);
            }
          };

          if (handle.session.isStreaming) {
            await runPromptTurn();
          } else {
            await runInSessionOperation(handle, runPromptTurn);
          }
        } else if (inputEntry.action === "abort") {
          const abortHandle = async (handle: SessionHandle) => {
            const turnId = handle.activeAssistantContext?.turnId ?? handle.currentTurnId ?? inputEntry.turnId ?? null;
            const abortMeta = (inputEntry as { meta?: Record<string, unknown> | null }).meta;
            const actorUserId = typeof abortMeta?.actorUserId === "string" && abortMeta.actorUserId.trim()
              ? abortMeta.actorUserId.trim()
              : typeof abortMeta?.userId === "string" && abortMeta.userId.trim()
                ? abortMeta.userId.trim()
                : null;
            handle.activeDirectShellCommand?.abortController.abort();
            await handle.session.abort();
            await handle.persistenceChain.catch(() => undefined);
            const completions = handle.pendingSteerCompletions.splice(0, handle.pendingSteerCompletions.length);
            for (const completion of completions) {
              await completion.reject("aborted").catch(() => undefined);
              completion.done();
            }
            handle.steerDrainPromise = null;
            if (turnId) {
              await abortSessionTurn({
                spaceId: handle.spaceId,
                sessionId: handle.sessionId,
                turnId,
                actorUserId,
              });
            }
            handle.lastActiveAt = Date.now();
            scheduleSessionIdleEviction(handle);
          };

          if (inputEntry.sessionId) {
            const handle = sessionHandles.get(getSessionKey(inputEntry.spaceId, inputEntry.sessionId));
            if (!handle) {
              console.warn(
                `[Agent] Abort requested for unknown session ${inputEntry.sessionId}`,
              );
              if (inputEntry.turnId) {
                const abortMeta = (inputEntry as { meta?: Record<string, unknown> | null }).meta;
                const actorUserId = typeof abortMeta?.actorUserId === "string" && abortMeta.actorUserId.trim()
                  ? abortMeta.actorUserId.trim()
                  : typeof abortMeta?.userId === "string" && abortMeta.userId.trim()
                    ? abortMeta.userId.trim()
                    : null;
                await abortSessionTurn({
                  spaceId: inputEntry.spaceId,
                  sessionId: inputEntry.sessionId,
                  turnId: inputEntry.turnId,
                  actorUserId,
                });
              }
            } else {
              await abortHandle(handle);
            }
          } else {
            await Promise.all(Array.from(sessionHandles.values()).map(abortHandle));
          }
          await ack();
        } else {
          await reject(`Unknown action: ${(inputEntry as { action?: string }).action}`);
        }
      } catch (error) {
        console.error("[Agent] Error processing input:", error);
        const sessionId = inputEntry.action === "prompt" ? inputEntry.sessionId : null;
        const errEvent: SessionStreamError = {
          type: "error",
          spaceId: inputEntry.spaceId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        };
        try {
          await sendOutput(errEvent);
        } catch (sendError) {
          console.error("[Agent] Failed to publish session error event:", sendError);
        }
        await reject(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("[Agent] Unhandled promise rejection:", reason);
  void shutdown(1);
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  console.error("[Agent] Uncaught exception monitor:", { origin, error });
});

process.on("SIGTERM", () => {
  logger.info("[Agent] SIGTERM received. Shutting down.");
  void shutdown(0);
});

process.on("SIGINT", () => {
  logger.info("[Agent] SIGINT received. Shutting down.");
  void shutdown(0);
});

main().catch(async (err) => {
  console.error("[Agent] Fatal error:", err);
  await shutdown(1);
});
