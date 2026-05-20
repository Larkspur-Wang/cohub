import type { SandboxHeartbeat } from "@cohub/protocol/sandbox";
import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
import { getSpaceSandbox, recoverSpaceSandbox } from "./api.js";
import { db } from "./db.js";
import { updateSpaceRuntime } from "./ownership.js";
import {
  disconnectSandboxWsClient,
  hasPendingSandboxRequests,
  startSandboxWsClient,
  type SandboxConnection,
  waitForSandboxConnection,
} from "./sandbox/ws-client.js";

const LOCAL_SANDBOX_SPACE_ID = process.env.LOCAL_SANDBOX_SPACE_ID?.trim() || null;
const LOCAL_SANDBOX_WS_URL = process.env.LOCAL_SANDBOX_WS_URL?.trim() || null;
const IDLE_TTL_MS = Number(process.env.AGENT_SANDBOX_IDLE_TTL_MS ?? 30 * 60_000);
const MAX_CONNECTIONS = Number(process.env.AGENT_SANDBOX_MAX_CONNECTIONS_PER_WORKER ?? 100);
const sandboxLifecycle = createSandboxLifecycleController({ db, infra: null });

type NormalizedSandboxStatus = "provisioning" | "ready" | "degraded" | "error";

type PoolEntry = {
  spaceId: string;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, PoolEntry>();
const wsUrlResolutions = new Map<string, Promise<string>>();

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
  await Promise.allSettled([
    sandboxLifecycle.recordHeartbeat({ spaceId, heartbeat: message }),
    updateSpaceRuntime({
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
    }),
  ]);
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
  if (sandbox?.status === "stopped" || sandbox?.status === "error" || sandbox?.status === "terminated") {
    await recoverSpaceSandbox({
      spaceId,
      reason: sandbox.status === "error" ? "auto_recover" : "auto_resume",
      source: "agent",
    });
    const resumed = (await getSpaceSandbox({ spaceId }))?.sandbox;
    const resumedMeta = (resumed?.meta as Record<string, unknown> | null) ?? null;
    const resumedPodIp = typeof resumedMeta?.podIp === "string" ? resumedMeta.podIp.trim() : "";
    if (resumedPodIp) return `ws://${resumedPodIp}:8788/sandbox`;
  }
  const meta = (sandbox?.meta as Record<string, unknown> | null) ?? null;
  const podIp = typeof meta?.podIp === "string" ? meta.podIp.trim() : "";
  if (!podIp) throw new Error(`sandbox is not ready for requests yet: missing podIp for ${spaceId}`);
  return `ws://${podIp}:8788/sandbox`;
}

function resolveSandboxWsUrlOnce(spaceId: string) {
  const existing = wsUrlResolutions.get(spaceId);
  if (existing) return existing;
  const promise = resolveSandboxWsUrl(spaceId).finally(() => {
    wsUrlResolutions.delete(spaceId);
  });
  wsUrlResolutions.set(spaceId, promise);
  return promise;
}

function disconnectEntry(spaceId: string, reason: string) {
  const entry = entries.get(spaceId);
  if (entry?.idleTimer) clearTimeout(entry.idleTimer);
  entries.delete(spaceId);
  disconnectSandboxWsClient(spaceId, reason);
}

function scheduleIdleEviction(entry: PoolEntry) {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    const current = entries.get(entry.spaceId);
    if (!current) return;
    const idleForMs = Date.now() - current.lastUsedAt;
    if (idleForMs < IDLE_TTL_MS) {
      scheduleIdleEviction(current);
      return;
    }
    if (hasPendingSandboxRequests(current.spaceId)) {
      scheduleIdleEviction(current);
      return;
    }
    disconnectEntry(current.spaceId, "sandbox pool idle eviction");
  }, IDLE_TTL_MS);
}

function touchSandboxConnection(spaceId: string) {
  const existing = entries.get(spaceId);
  const entry = existing ?? { spaceId, lastUsedAt: Date.now(), idleTimer: null };
  entry.lastUsedAt = Date.now();
  if (existing) entries.delete(spaceId);
  entries.set(spaceId, entry);
  scheduleIdleEviction(entry);
}

export async function ensureSandboxConnection(spaceId: string, options?: { timeoutMs?: number }): Promise<SandboxConnection> {
  touchSandboxConnection(spaceId);
  const wsUrl = await resolveSandboxWsUrlOnce(spaceId);
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
  const connection = await waitForSandboxConnection(spaceId, options?.timeoutMs);
  touchSandboxConnection(spaceId);
  pruneSandboxConnections({ preserveSpaceId: spaceId });
  return connection;
}

export function pruneSandboxConnections(options?: { preserveSpaceId?: string }) {
  if (entries.size <= MAX_CONNECTIONS) return;

  let skippedPending = 0;
  for (const entry of [...entries.values()]) {
    if (entries.size <= MAX_CONNECTIONS) break;
    if (entry.spaceId === options?.preserveSpaceId) continue;
    if (hasPendingSandboxRequests(entry.spaceId)) {
      skippedPending += 1;
      continue;
    }
    disconnectEntry(entry.spaceId, "sandbox pool LRU pruning");
  }

  if (entries.size > MAX_CONNECTIONS) {
    console.warn(`[SandboxPool] max connections exceeded (${entries.size}/${MAX_CONNECTIONS}); skipped ${skippedPending} connections with pending requests`);
  }
}

export function closeSandboxPool() {
  for (const entry of entries.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    disconnectSandboxWsClient(entry.spaceId, "agent shutdown");
  }
  entries.clear();
  wsUrlResolutions.clear();
}
