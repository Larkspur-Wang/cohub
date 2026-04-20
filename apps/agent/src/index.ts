import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { ContentBlock, SessionStreamError } from "@cohub/protocol";
import type { SandboxHeartbeat, SandboxHello } from "@cohub/agent-sandbox-protocol";

import {
  env,
  hasPlatformSkillsDir,
  PLATFORM_AGENT_DIR,
  PLATFORM_AUTH_PATH,
  PLATFORM_MODELS_PATH,
  PLATFORM_ROOT,
  PLATFORM_SKILLS_DIR,
  SPACE_OWNER_LEASE_MS,
} from "./env.js";
import {
  closeOwnershipRedis,
  getSpaceOwner,
  renewSpaceOwner,
  startAgentInstanceHeartbeatLoop,
  updateSpaceRuntime,
} from "./ownership.js";
import {
  closeRedisConnections,
  extractContentImages,
  extractContentText,
  listenForInput,
  sendOutput,
} from "./redis.js";
import { getSpaceSandbox } from "./api.js";
import { createSandboxCodingTools } from "./sandbox/tools.js";
import {
  disconnectSandboxWsClient,
  startSandboxWsClient,
  waitForSandboxConnection,
} from "./sandbox/ws-client.js";
import {
  getSessionKey,
  loadOrCreateSessionHandle,
  type SessionHandle,
} from "./session.js";
import { runWithToolExecutionContext } from "./tool-context.js";

const LOCAL_SANDBOX_SPACE_ID = process.env.LOCAL_SANDBOX_SPACE_ID?.trim() || null;
const LOCAL_SANDBOX_WS_URL = process.env.LOCAL_SANDBOX_WS_URL?.trim() || null;

type NormalizedSandboxStatus = "provisioning" | "ready" | "error";
type RuntimeSandboxStatus = "idle" | "ready" | "error";

let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();
const ownedSpaceEpochs = new Map<string, number>();
let agentHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ownerRenewTimer: ReturnType<typeof setInterval> | null = null;

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

async function syncSandboxHello(spaceId: string, message: SandboxHello) {
  const normalized = normalizeSandboxStatus(message.metadata?.prepareStatus ?? "preparing");
  await updateSpaceRuntime({
    spaceId,
    status: toRuntimeSandboxStatus(normalized),
    sandboxId: message.sandboxId,
    error: message.metadata?.prepareError ?? null,
  }).catch(() => undefined);
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

async function cleanupOwnedSpace(spaceId: string, reason: string) {
  console.warn(`[Agent] Cleaning up owned space ${spaceId}: ${reason}`);
  ownedSpaceEpochs.delete(spaceId);

  const handlesToDispose = Array.from(sessionHandles.entries()).filter(([key, handle]) => {
    return handle.spaceId === spaceId || key.startsWith(`${spaceId}:`);
  });

  for (const [key, handle] of handlesToDispose) {
    try {
      await handle.persistenceChain.catch(() => undefined);
      handle.session.dispose();
    } catch (error) {
      console.error(`[Agent] Failed to dispose session ${handle.sessionId} during cleanup of ${spaceId}:`, error);
    } finally {
      sessionHandles.delete(key);
    }
  }

  disconnectSandboxWsClient(spaceId, reason);
}

async function shutdown(exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  try {
    for (const handle of sessionHandles.values()) {
      try {
        await handle.persistenceChain.catch((error) => {
          console.error(
            `[Agent] Failed while draining persistence chain for ${handle.sessionId}:`,
            error,
          );
        });
        handle.session.dispose();
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
      onHello: (message) => syncSandboxHello(spaceId, message),
      onHeartbeat: (message) => syncSandboxHeartbeat(spaceId, message),
      onDisconnected: ({ reason }) => {
        void syncSandboxConnectionState({
          spaceId,
          status: "provisioning",
          reason: reason ?? "sandbox disconnected",
        });
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
    for (const [spaceId, epoch] of ownedSpaceEpochs) {
      void renewSpaceOwner(spaceId, epoch).then((ok: boolean) => {
        if (!ok) {
          void cleanupOwnedSpace(spaceId, `ownership lost at epoch ${epoch}`);
        }
      }).catch((error: unknown) => {
        console.error(`[Agent] Failed to renew ownership for ${spaceId}:`, error);
      });
    }
  }, Math.max(1000, Math.floor(SPACE_OWNER_LEASE_MS / 3)));
}

async function verifyInputOwnership(inputEntry: { spaceId: string; expectedOwnerId: string; expectedEpoch: number }) {
  if (inputEntry.expectedOwnerId !== env.AGENT_INSTANCE_ID) return false;
  const lease = await getSpaceOwner(inputEntry.spaceId);
  if (!lease) return false;
  if (lease.ownerId !== env.AGENT_INSTANCE_ID) return false;
  if (lease.epoch !== inputEntry.expectedEpoch) return false;
  if (lease.leaseUntil <= Date.now()) return false;
  ownedSpaceEpochs.set(inputEntry.spaceId, lease.epoch);
  return true;
}

async function main() {
  console.log(`[Agent] Starting instance: ${env.AGENT_INSTANCE_ID}`);
  console.log(`[Agent] Workspace root: ${env.WORKSPACE_ROOT}`);
  console.log(`[Agent] Sessions root: ${env.SESSIONS_DIR}`);
  console.log(`[Agent] Platform config root: ${env.PLATFORM_CONFIG_ROOT}`);
  console.log(`[Agent] Platform config dir: ${PLATFORM_ROOT}`);
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

  const authStorage = AuthStorage.create(PLATFORM_AUTH_PATH);
  const modelRegistry = ModelRegistry.create(authStorage, PLATFORM_MODELS_PATH);
  const resourceLoader = new DefaultResourceLoader({
    agentDir: PLATFORM_AGENT_DIR,
    additionalSkillPaths: hasPlatformSkillsDir() ? [PLATFORM_SKILLS_DIR] : [],
  });
  try {
    await resourceLoader.reload();
  } catch (error) {
    console.error("[Agent] Failed to load platform resources:", error);
    throw error;
  }
  const tools = createSandboxCodingTools();

  console.log("[Agent] Listening for owner-routed input.");

  await listenForInput((inputEntry, _rawMessage, ack, reject) => {
    console.log("[Agent] Received input from Redis:", inputEntry);

    (async () => {
      try {
        const ownershipOk = await verifyInputOwnership(inputEntry);
        if (!ownershipOk) {
          throw new Error(`ownership mismatch for space=${inputEntry.spaceId}, expectedOwner=${inputEntry.expectedOwnerId}, instance=${env.AGENT_INSTANCE_ID}, expectedEpoch=${inputEntry.expectedEpoch}`);
        }

        if (inputEntry.action === "prompt") {
          await ensureSandboxWsConnected(inputEntry.spaceId);

          const sessionId = inputEntry.sessionId;
          if (!sessionId) {
            throw new Error("sessionId is required for prompt inputs");
          }

          const meta = (inputEntry as { meta?: Record<string, unknown> | null }).meta;
          const requestedProvider = meta?.provider as string | undefined;
          const requestedModel = meta?.model as string | undefined;
          const requestedModelInput = (requestedProvider && requestedModel)
            ? { provider: requestedProvider, id: requestedModel }
            : undefined;

          const handle = await loadOrCreateSessionHandle({
            spaceId: inputEntry.spaceId,
            sessionId,
            authStorage,
            modelRegistry,
            resourceLoader,
            tools,
            model: requestedModelInput,
            sessionHandles,
          });

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

          const content = inputEntry.content as ContentBlock[];
          const userMessageId = inputEntry.userMessageId;
          if (userMessageId) {
            handle.pendingUserMessages.push({
              userMessageId,
              content,
              meta: meta ?? null,
            });
          }

          const text = extractContentText(content);
          const images = extractContentImages(content);

          if (handle.session.isStreaming) {
            console.log(
              `[Agent] Session ${sessionId} is streaming, using steer for new message`,
            );
            await runWithToolExecutionContext({
              spaceId: inputEntry.spaceId,
              sessionId,
            }, async () => {
              await handle.session.steer(text, images);
            });
          } else {
            console.log(
              `[Agent] Session ${sessionId} is idle, using prompt for new message`,
            );
            await runWithToolExecutionContext({
              spaceId: inputEntry.spaceId,
              sessionId,
            }, async () => {
              await handle.session.prompt(text, {
                images,
              });
            });
          }

          await ack();
        } else if (inputEntry.action === "abort") {
          if (inputEntry.sessionId) {
            const handle = sessionHandles.get(getSessionKey(inputEntry.spaceId, inputEntry.sessionId));
            if (!handle) {
              console.warn(
                `[Agent] Abort requested for unknown session ${inputEntry.sessionId}`,
              );
            } else {
              await handle.session.abort();
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
      }
    })();
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
