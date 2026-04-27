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
import { getSpace, getSpaceSandbox } from "./api.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import {
  disconnectSandboxWsClient,
  startSandboxWsClient,
  waitForSandboxConnection,
} from "./sandbox/ws-client.js";
import { clearCurrentSessionExecutionAuth } from "./runtime/session-execution-auth.js";
import {
  getSessionKey,
  loadOrCreateSessionHandle,
  type SessionHandle,
} from "./session.js";
import { CohubModelRegistry } from "./runtime/model-registry.js";

import {
  getAgentPlatformConfigPath,
} from "./runtime/paths.js";
import { runWithToolExecutionContext } from "./tool-context.js";
const LOCAL_SANDBOX_SPACE_ID = process.env.LOCAL_SANDBOX_SPACE_ID?.trim() || null;
const LOCAL_SANDBOX_WS_URL = process.env.LOCAL_SANDBOX_WS_URL?.trim() || null;

type NormalizedSandboxStatus = "provisioning" | "ready" | "error";
type RuntimeSandboxStatus = "idle" | "ready" | "error";

type CachedModelRegistry = {
  registry: CohubModelRegistry;
  lastUsedAt: number;
};

const MAX_CACHED_MODEL_REGISTRIES = 128;
let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();
const modelRegistries = new Map<string, CachedModelRegistry>();
let agentHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ownerRenewTimer: ReturnType<typeof setInterval> | null = null;
const SESSION_IDLE_EVICTION_MS = 5 * 60 * 1000;
const sessionTurnCounters = new Map<string, number>();

function normalizeSandboxStatus(status: string): NormalizedSandboxStatus {
  return status === "ready" || status === "busy"
    ? "ready"
    : status === "error"
      ? "error"
      : "provisioning";
}

function toRuntimeSandboxStatus(status: NormalizedSandboxStatus): RuntimeSandboxStatus {
  return status === "ready" ? "ready" : status === "error" ? "error" : "idle";
}

async function syncSandboxHeartbeat(spaceId: string, message: SandboxHeartbeat) {
  const normalized = normalizeSandboxStatus(message.status);
  await updateSpaceRuntime({
    spaceId,
    status: toRuntimeSandboxStatus(normalized),
    sandboxId: message.sandboxId,
    error: normalized === "error" ? `sandbox heartbeat reported ${message.status}` : null,
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
    await handle.persistenceChain.catch(() => undefined);
    clearCurrentSessionExecutionAuth(handle.sessionId);
    handle.session.dispose();
  } catch (error) {
    console.error(`[Agent] Failed to dispose session ${handle.sessionId}:`, error);
  } finally {
    sessionHandles.delete(handle.sessionKey);
    sessionTurnCounters.delete(handle.sessionKey);
    evictUnusedModelRegistries();
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
  console.log(`[Session] idle:scheduled sessionId=${handle.sessionId} in=${SESSION_IDLE_EVICTION_MS}ms`);
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
    throw new Error(`sandbox endpoint unavailable for ${spaceId}`);
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

function evictUnusedModelRegistries() {
  if (modelRegistries.size <= MAX_CACHED_MODEL_REGISTRIES) return;

  const activeUserIds = new Set(
    Array.from(sessionHandles.values())
      .map((handle) => handle.spaceOwnerUserId?.trim() || "__platform__"),
  );

  const candidates = Array.from(modelRegistries.entries())
    .filter(([key]) => key !== "__platform__" && !activeUserIds.has(key))
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

  while (modelRegistries.size > MAX_CACHED_MODEL_REGISTRIES && candidates.length > 0) {
    const entry = candidates.shift();
    if (!entry) break;
    const [key] = entry;
    modelRegistries.delete(key);
  }
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
    console.log(`[Agent] steer:fallback-to-prompt sessionId=${input.sessionId}`);
    await input.handle.session.prompt(input.text, {
      images: input.images,
    });
    console.log(`[Agent] ack input sessionId=${input.sessionId}`);
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
        console.log(`[Agent] steer:drain:start sessionId=${input.handle.sessionId}`);
        await input.handle.session.waitForIdle();
        console.log(`[Agent] steer:drain:end sessionId=${input.handle.sessionId}`);
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

function getModelRegistryForUser(userId: string | null | undefined) {
  const key = userId?.trim() || "__platform__";
  const now = Date.now();
  const cached = modelRegistries.get(key);
  if (cached) {
    cached.lastUsedAt = now;
    return cached.registry;
  }

  const registry = new CohubModelRegistry({ userId: userId?.trim() || null });
  if (registry.getError()) {
    console.warn(`[Agent] Model registry warning for ${key}:`, registry.getError());
  }
  modelRegistries.set(key, { registry, lastUsedAt: now });
  evictUnusedModelRegistries();
  return registry;
}

async function main() {
  console.log(`[Agent] Starting instance: ${env.AGENT_INSTANCE_ID}`);
  console.log(`[Agent] Workspace root: ${env.WORKSPACE_ROOT}`);
  console.log(`[Agent] Sessions root: ${env.SESSIONS_DIR}`);
  console.log(`[Agent] Platform config root: ${env.PLATFORM_CONFIG_ROOT}`);
  console.log(`[Agent] Platform config dir: ${getAgentPlatformConfigPath()}`);
  console.log("[Agent] Build features:", {
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

  console.log("[Agent] Listening for owner-routed input.");

  const agentTracer = getAgentTracer();

  await listenForInput((inputEntry, _rawMessage, ack, reject, rawParsed) => {
    console.log("[Agent] Received input from Redis:", inputEntry);

    // Extract trace context from the message (injected by API)
    const parentCtx = extractTrace(rawParsed);

    void runInActiveSpan(agentTracer, "agent.input.consume", {
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
          const modelRegistry = getModelRegistryForUser(spaceOwnerUserId);
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
          const actorUserId = typeof meta?.actorUserId === "string" && meta.actorUserId.trim()
            ? meta.actorUserId.trim()
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

            const currentModel = handle.session.agent.state.model;
            if (requestedProvider && requestedModel && currentModel) {
              if (!(currentModel.provider === requestedProvider && currentModel.id === requestedModel)) {
                const targetModel = handle.session.modelRegistry.find(requestedProvider, requestedModel);
                if (targetModel) {
                  console.log(
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

            if (userMessageId) {
              handle.pendingUserMessages.push({
                userMessageId,
                content,
                meta: meta ?? null,
              });
              handle.pendingExecutionAuths.push({
                actorUserId,
                executionToken,
              });
            }

            const sessionKey = getSessionKey(inputEntry.spaceId, sessionId);
            const turnSeq = nextTurnSequence(sessionKey);
            const turnId = randomUUID();
            const turnMetrics = { llmRoundCount: 0, toolCallCount: 0 };
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
              handle.currentTurnId = turnId;
              handle.currentTurnSeq = turnSeq;
              handle.currentLlmRound = 0;
              if (handle.session.isStreaming) {
                console.log(
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
                  console.log(`[Agent] steer:start sessionId=${sessionId}`);
                  await enqueueStreamingSteerAndWait({
                    handle,
                    sessionId,
                    text,
                    images,
                    ack,
                    reject,
                  });
                  console.log(`[Agent] steer:end sessionId=${sessionId}`);
                });
              } else {
                console.log(
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
                  console.log(`[Agent] prompt:start sessionId=${sessionId}`);
                  await handle.session.prompt(text, {
                    images,
                  });
                  console.log(`[Agent] prompt:end sessionId=${sessionId}`);
                });
              }

              turnSpan.setAttribute("agent.llm_round_count", turnMetrics.llmRoundCount);
              turnSpan.setAttribute("agent.tool_count", turnMetrics.toolCallCount);
              turnSpan.setAttribute("agent.outcome", "ok");
              handle.currentLlmRound = turnMetrics.llmRoundCount;
            });

            if (mode === "prompt") {
              console.log(`[Agent] ack input sessionId=${sessionId}`);
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
          if (inputEntry.sessionId) {
            const handle = sessionHandles.get(getSessionKey(inputEntry.spaceId, inputEntry.sessionId));
            if (!handle) {
              console.warn(
                `[Agent] Abort requested for unknown session ${inputEntry.sessionId}`,
              );
            } else {
              await handle.session.abort();
              handle.lastActiveAt = Date.now();
              scheduleSessionIdleEviction(handle);
            }
          } else {
            await Promise.all(
              Array.from(sessionHandles.values()).map((handle) => handle.session.abort()),
            );
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
          error: String(error),
        };
        await sendOutput(errEvent);
        await reject(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });
}

process.on("SIGTERM", () => {
  console.log("[Agent] SIGTERM received. Shutting down.");
  void shutdown(0);
});

process.on("SIGINT", () => {
  console.log("[Agent] SIGINT received. Shutting down.");
  void shutdown(0);
});

main().catch(async (err) => {
  console.error("[Agent] Fatal error:", err);
  await shutdown(1);
});
