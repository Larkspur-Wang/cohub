import type { SandboxHeartbeat } from "@cohub/protocol/sandbox";
import { getSpaceSandbox } from "./api.js";
import { updateSpaceRuntime } from "./ownership.js";
import { startSandboxWsClient, waitForSandboxConnection, disconnectSandboxWsClient } from "./sandbox/ws-client.js";

const LOCAL_SANDBOX_SPACE_ID = process.env.LOCAL_SANDBOX_SPACE_ID?.trim() || null;
const LOCAL_SANDBOX_WS_URL = process.env.LOCAL_SANDBOX_WS_URL?.trim() || null;
const IDLE_TTL_MS = Number(process.env.AGENT_SANDBOX_IDLE_TTL_MS ?? 30 * 60_000);
const MAX_CONNECTIONS = Number(process.env.AGENT_SANDBOX_MAX_CONNECTIONS_PER_WORKER ?? 100);

type NormalizedSandboxStatus = "provisioning" | "ready" | "degraded" | "error";

type PoolEntry = {
  spaceId: string;
  activeCount: number;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, PoolEntry>();

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

async function syncSandboxConnectionState(input: { spaceId: string; status: NormalizedSandboxStatus; reason: string }) {
  await updateSpaceRuntime({
    spaceId: input.spaceId,
    status: toRuntimeSandboxStatus(input.status),
    error: input.reason,
  }).catch(() => undefined);
}

async function resolveSandboxWsUrl(spaceId: string): Promise<string> {
  if (LOCAL_SANDBOX_SPACE_ID && LOCAL_SANDBOX_WS_URL && spaceId === LOCAL_SANDBOX_SPACE_ID) {
    return LOCAL_SANDBOX_WS_URL;
  }
  const response = await getSpaceSandbox({ spaceId });
  const sandbox = response?.sandbox;
  const meta = (sandbox?.meta as Record<string, unknown> | null) ?? null;
  const podIp = typeof meta?.podIp === "string" ? meta.podIp.trim() : "";
  if (!podIp) throw new Error(`sandbox is not ready for requests yet: missing podIp for ${spaceId}`);
  return `ws://${podIp}:8788/sandbox`;
}

function pruneIdleConnections() {
  const idle = [...entries.values()]
    .filter((entry) => entry.activeCount <= 0)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  while (entries.size >= MAX_CONNECTIONS && idle.length > 0) {
    const entry = idle.shift();
    if (!entry) break;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entries.delete(entry.spaceId);
    disconnectSandboxWsClient(entry.spaceId, "sandbox pool capacity pruning");
  }
  if (entries.size >= MAX_CONNECTIONS) {
    console.warn(`[SandboxPool] max connections reached (${entries.size}/${MAX_CONNECTIONS}); allowing temporary overflow because all connections are active`);
  }
}

export async function acquireSandbox(spaceId: string) {
  let entry = entries.get(spaceId);
  if (!entry) {
    pruneIdleConnections();
    entry = { spaceId, activeCount: 0, lastUsedAt: Date.now(), idleTimer: null };
    entries.set(spaceId, entry);
  }
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  entry.activeCount += 1;
  entry.lastUsedAt = Date.now();

  try {
    const wsUrl = await resolveSandboxWsUrl(spaceId);
    await startSandboxWsClient({
      spaceId,
      wsUrl,
      hooks: {
        onHeartbeat: (message) => syncSandboxHeartbeat(spaceId, message),
        onDisconnected: ({ reason }) => syncSandboxConnectionState({
          spaceId,
          status: "provisioning",
          reason: reason ?? "sandbox disconnected",
        }),
        onConnectionError: ({ error }) => syncSandboxConnectionState({
          spaceId,
          status: "provisioning",
          reason: error.message,
        }),
      },
    });
    await waitForSandboxConnection(spaceId);

    return {
      release: () => releaseSandbox(spaceId),
    };
  } catch (error) {
    releaseSandbox(spaceId);
    throw error;
  }
}

function releaseSandbox(spaceId: string) {
  const entry = entries.get(spaceId);
  if (!entry) return;
  entry.activeCount = Math.max(0, entry.activeCount - 1);
  entry.lastUsedAt = Date.now();
  if (entry.activeCount > 0 || entry.idleTimer) return;
  entry.idleTimer = setTimeout(() => {
    const current = entries.get(spaceId);
    if (!current || current.activeCount > 0) return;
    entries.delete(spaceId);
    disconnectSandboxWsClient(spaceId, "sandbox pool idle eviction");
  }, IDLE_TTL_MS);
}

export function closeSandboxPool() {
  for (const entry of entries.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    disconnectSandboxWsClient(entry.spaceId, "agent shutdown");
  }
  entries.clear();
}
