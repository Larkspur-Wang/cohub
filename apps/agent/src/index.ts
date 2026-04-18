import {
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import type { WorkspacePrepareResult } from "@cohub/agent-sandbox-protocol";
import type { ContentBlock, SessionStreamError } from "@cohub/protocol";
import { getSandboxConnectionInfo } from "./api.js";
import { env, SPACE_OWNER_LEASE_MS } from "./env.js";
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
  reportSandboxStatus,
} from "./redis.js";
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



let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();
const ownedSpaceEpochs = new Map<string, number>();
const preparePromises = new Map<string, Promise<void>>();
let agentHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let ownerRenewTimer: ReturnType<typeof setInterval> | null = null;

async function cleanupOwnedSpace(spaceId: string, reason: string) {
  console.warn(`[Agent] Cleaning up owned space ${spaceId}: ${reason}`);
  ownedSpaceEpochs.delete(spaceId);
  preparePromises.delete(spaceId);

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

async function shutdown(status: "stopped" | "error", exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  try {
    const spaceIds = new Set<string>([
      ...ownedSpaceEpochs.keys(),
      ...Array.from(sessionHandles.values()).map((handle) => handle.spaceId),
    ]);

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

    await Promise.allSettled(
      Array.from(spaceIds).map((spaceId) =>
        reportSandboxStatus(spaceId, status === "stopped" ? "stopped" : "error"),
      ),
    );
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



async function ensureSandboxReadyForSpace(spaceId: string) {
  const existing = preparePromises.get(spaceId);
  if (existing) {
    await existing;
    return;
  }

  const preparePromise = (async () => {
    const connection = await waitForSandboxConnection(spaceId, 1000).catch(() => null);
    if (connection) {
      await updateSpaceRuntime({
        spaceId,
        status: "ready",
        wsUrl: null,
        sandboxId: connection.sandboxId,
      }).catch(() => undefined);
      return;
    }

    await updateSpaceRuntime({ spaceId, status: "connecting" }).catch(() => undefined);

    if (LOCAL_SANDBOX_SPACE_ID && LOCAL_SANDBOX_WS_URL && spaceId === LOCAL_SANDBOX_SPACE_ID) {
      await startSandboxWsClient({ spaceId, wsUrl: LOCAL_SANDBOX_WS_URL });
      const readyConnection = await waitForSandboxConnection(spaceId);
      await updateSpaceRuntime({
        spaceId,
        status: "preparing",
        wsUrl: LOCAL_SANDBOX_WS_URL,
        sandboxId: readyConnection.sandboxId,
      }).catch(() => undefined);
      await prepareRemoteSandbox(spaceId);
      return;
    }

    const info = await getSandboxConnectionInfo(spaceId);
    if (!info?.wsUrl) {
      await updateSpaceRuntime({ spaceId, status: "error", error: `No sandbox ws url available for space ${spaceId}` }).catch(() => undefined);
      throw new Error(`No sandbox ws url available for space ${spaceId}`);
    }

    await startSandboxWsClient({ spaceId, wsUrl: info.wsUrl });
    const readyConnection = await waitForSandboxConnection(spaceId);
    await updateSpaceRuntime({
      spaceId,
      status: "preparing",
      wsUrl: info.wsUrl,
      sandboxId: readyConnection.sandboxId,
    }).catch(() => undefined);
    await prepareRemoteSandbox(spaceId);
  })();

  preparePromises.set(spaceId, preparePromise);
  try {
    await preparePromise;
  } finally {
    if (preparePromises.get(spaceId) === preparePromise) {
      preparePromises.delete(spaceId);
    }
  }
}

async function prepareRemoteSandbox(spaceId: string) {
  const connection = await waitForSandboxConnection(spaceId);
  const result = await connection.request("workspace.prepare", {}, {
    spaceId,
    sandboxId: connection.sandboxId,
  }) as WorkspacePrepareResult;

  console.log("[Agent] Remote sandbox prepared:", result);
  await updateSpaceRuntime({
    spaceId,
    status: "ready",
    sandboxId: connection.sandboxId,
    preparedAt: Date.now(),
    wsUrl: null,
  }).catch(() => undefined);
  await reportSandboxStatus(spaceId, "ready", {
    workspaceDir: result.workspaceDir,
    repoCloned: result.repoCloned,
    configApplied: result.configApplied,
    preparedAt: new Date().toISOString(),
    sandboxId: connection.sandboxId,
  });
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
  console.log(`[Agent] Agent version: ${env.AGENT_VERSION || "unknown"}`);
  console.log(`[Agent] Public URL prefix: ${env.PUBLIC_URL_PREFIX || "not set"}`);
  console.log("[Agent] Build features:", {
    env: env.ENV,
    agentInstanceId: env.AGENT_INSTANCE_ID,
    localSandboxSpaceId: LOCAL_SANDBOX_SPACE_ID,
    localSandboxWsUrl: LOCAL_SANDBOX_WS_URL,
    agentVersion: env.AGENT_VERSION || null,
    publicUrlPrefix: env.PUBLIC_URL_PREFIX || null,
    internalApiBaseUrl:
      env.ENV === "prod"
        ? "http://cohub-api.cohub.svc.cluster.local:8787"
        : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787",
    sessionOwnershipManagedByAgent: true,
    multiSessionRestore: true,
  });

  agentHeartbeatTimer = startAgentInstanceHeartbeatLoop();
  startOwnerRenewLoop();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const tools = createSandboxCodingTools();

  console.log("[Agent] Listening for owner-routed input.");

  await listenForInput((inputEntry, _rawMessage, ack, reject) => {
    console.log("[Agent] Received input from Redis:", inputEntry);

    // Fire and forget async handler
    (async () => {
      try {
        const ownershipOk = await verifyInputOwnership(inputEntry);
        if (!ownershipOk) {
          throw new Error(`ownership mismatch for space=${inputEntry.spaceId}, expectedOwner=${inputEntry.expectedOwnerId}, instance=${env.AGENT_INSTANCE_ID}, expectedEpoch=${inputEntry.expectedEpoch}`);
        }

        await ensureSandboxReadyForSpace(inputEntry.spaceId);

        if (inputEntry.action === "prompt") {
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
            tools,
            model: requestedModelInput,
            sessionHandles,
          });

          // If this is an existing session (handle was reused), switch model before enqueueing
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

          // Input now carries ContentBlock[] — extract text + images for SDK
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

          // Decide whether to use prompt or steer based on streaming state
          if (handle.session.isStreaming) {
            console.log(
              `[Agent] Session ${sessionId} is streaming, using steer for new message`
            );
            await runWithToolExecutionContext({
              spaceId: inputEntry.spaceId,
              sessionId,
            }, async () => {
              await handle.session.steer(text, images);
            });
          } else {
            console.log(
              `[Agent] Session ${sessionId} is idle, using prompt for new message`
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
  void shutdown("stopped", 0);
});

process.on("SIGINT", () => {
  console.log("[Agent] SIGINT received. Shutting down.");
  void shutdown("stopped", 0);
});

main().catch(async (err) => {
  console.error("[Agent] Fatal error:", err);
  await shutdown("error", 1);
});
