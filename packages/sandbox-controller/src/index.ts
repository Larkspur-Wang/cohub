import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { spaceSandboxes } from "@cohub/db";
import type { RpcMethod, SandboxHeartbeat, SandboxStatus } from "@cohub/protocol/sandbox";

export const SANDBOX_LIFECYCLE_STATUSES = [
  "pending",
  "provisioning",
  "ready",
  "running",
  "stopping",
  "stopped",
  "error",
  "terminated",
] as const;

export type SandboxLifecycleStatus = (typeof SANDBOX_LIFECYCLE_STATUSES)[number];

export const SANDBOX_RUNTIME_STATUSES = [
  "unknown",
  "starting",
  "healthy",
  "degraded",
  "unhealthy",
] as const;

export type SandboxRuntimeStatus = (typeof SANDBOX_RUNTIME_STATUSES)[number];

export const SANDBOX_STOP_REASONS = ["idle", "manual", "replaced"] as const;
export type SandboxStopReason = (typeof SANDBOX_STOP_REASONS)[number];

export type SandboxActivityReason = "rpc" | "manual" | "resume";
export type SandboxResumeReason = "rpc" | "new_message" | "manual" | "auto_recover";

export type RedisLike = {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
};

export type LoggerLike = Pick<Console, "info" | "warn" | "error">;

type SpaceSandboxRow = typeof spaceSandboxes.$inferSelect;

type ControllerDb = PostgresJsDatabase<Record<string, unknown>>;

export type SandboxInfraAdapter = {
  deletePod(input: { podName: string }): Promise<void>;
  waitForPodDeleted(input: { podName: string; timeoutMs?: number }): Promise<boolean>;
  resumeSandbox(input: { spaceId: string; reason: SandboxResumeReason }): Promise<unknown>;
};

export type SandboxLifecycleController = ReturnType<typeof createSandboxLifecycleController>;

const DEFAULT_LOCK_TTL_MS = 10 * 60_000;
const DEFAULT_IDLE_TTL_MS = 48 * 60 * 60_000;
const DEFAULT_REAPER_LIMIT = 50;

const RUNNING_STATUSES = ["ready", "running"] as const;

const nowDate = () => new Date();

export function isSandboxUsableStatus(status: string | null | undefined) {
  return status === "ready" || status === "running";
}

export function isSandboxPromptAcceptingStatus(status: string | null | undefined) {
  return isSandboxUsableStatus(status) || status === "stopped" || status === "stopping";
}

export function normalizeSandboxRuntimeStatus(status: SandboxStatus | string | null | undefined): SandboxRuntimeStatus {
  if (status === "ready" || status === "busy") return "healthy";
  if (status === "connecting" || status === "preparing") return "starting";
  if (status === "degraded") return "degraded";
  if (status === "error") return "unhealthy";
  return "unknown";
}

export function normalizeSandboxLifecycleStatus(status: SandboxStatus | string | null | undefined): SandboxLifecycleStatus {
  if (status === "ready" || status === "busy") return "running";
  if (status === "connecting" || status === "preparing" || status === "provisioning" || status === "pending") return "provisioning";
  if (status === "stopping" || status === "stopped" || status === "error" || status === "terminated") return status;
  if (status === "running") return "running";
  if (status === "degraded") return "running";
  return "pending";
}

export function getIdleBaseAt(row: Pick<SpaceSandboxRow, "lastActivityAt" | "lastHeartbeatAt" | "createdAt">) {
  return row.lastActivityAt ?? row.lastHeartbeatAt ?? row.createdAt ?? null;
}

export function isIdleCandidate(row: Pick<SpaceSandboxRow, "status" | "lastActivityAt" | "lastHeartbeatAt" | "createdAt">, input: { now?: Date; idleTtlMs?: number } = {}) {
  if (!isSandboxUsableStatus(row.status)) return false;
  const baseAt = getIdleBaseAt(row);
  if (!baseAt) return false;
  const now = input.now ?? nowDate();
  const idleTtlMs = input.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  return now.getTime() - baseAt.getTime() >= idleTtlMs;
}

function toReportMeta(heartbeat: SandboxHeartbeat) {
  return {
    podName: heartbeat.metadata?.podName ?? null,
    sandboxId: heartbeat.sandboxId,
    hostname: heartbeat.metadata?.hostname ?? null,
    imageVersion: heartbeat.metadata?.imageVersion ?? null,
    startedAt: heartbeat.metadata?.startedAt ?? null,
    heartbeatStatus: heartbeat.status,
  };
}

function lockValue() {
  return `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

const LOCK_RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  end
  return 0
`;

export function createSandboxLifecycleController(input: {
  db: ControllerDb;
  redis?: RedisLike | null;
  infra?: SandboxInfraAdapter | null;
  logger?: LoggerLike;
  lockTtlMs?: number;
}) {
  const db = input.db;
  const logger = input.logger ?? console;
  const lockTtlMs = input.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const infra = input.infra ?? null;

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | { locked: true }> {
    if (!input.redis) return fn();
    const token = lockValue();
    const locked = await input.redis.set(key, token, "PX", lockTtlMs, "NX");
    if (locked !== "OK") return { locked: true };
    try {
      return await fn();
    } finally {
      await input.redis.eval(LOCK_RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
    }
  }

  async function getSandbox(spaceId: string) {
    const [sandbox] = await db.select().from(spaceSandboxes).where(eq(spaceSandboxes.spaceId, spaceId)).limit(1);
    return sandbox ?? null;
  }

  async function recordActivity(input: {
    spaceId: string;
    reason: SandboxActivityReason;
    rpcMethod?: RpcMethod | string | null;
    at?: Date;
  }) {
    const at = input.at ?? nowDate();
    const patch = {
      lastActivityReason: input.reason,
      lastActivityRpcMethod: input.rpcMethod ?? null,
      lastActivityRecordedAt: at.toISOString(),
    };
    const [sandbox] = await db.update(spaceSandboxes).set({
      lastActivityAt: at,
      meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: at,
    }).where(eq(spaceSandboxes.spaceId, input.spaceId)).returning();
    return sandbox ?? null;
  }

  async function recordHeartbeat(input: { spaceId: string; heartbeat: SandboxHeartbeat; at?: Date }) {
    const at = input.at ?? nowDate();
    const heartbeat = input.heartbeat;
    const runtimeStatus = normalizeSandboxRuntimeStatus(heartbeat.status);
    const lifecycleStatus = normalizeSandboxLifecycleStatus(heartbeat.status);
    const reportedImageVersion = heartbeat.metadata?.imageVersion?.trim() || null;
    const existing = await getSandbox(input.spaceId);
    const reportMeta = toReportMeta(heartbeat);
    const shouldRefreshReport = Boolean(
      reportedImageVersion ||
      heartbeat.capabilities ||
      heartbeat.filesystem ||
      heartbeat.metadata,
    );

    const [sandbox] = await db.update(spaceSandboxes).set({
      status: lifecycleStatus === "running" ? "running" : lifecycleStatus,
      podName: heartbeat.metadata?.podName ?? existing?.podName ?? `sandbox-${input.spaceId}`,
      runtimeStatus,
      reportedImageVersion: reportedImageVersion ?? existing?.reportedImageVersion ?? null,
      ...(shouldRefreshReport ? { reportedAt: at } : {}),
      lastHeartbeatAt: at,
      stoppedAt: null,
      stopReason: null,
      meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify(reportMeta)}::jsonb`,
      updatedAt: at,
    }).where(eq(spaceSandboxes.spaceId, input.spaceId)).returning();
    return sandbox ?? null;
  }

  async function ensureRunning(input: { spaceId: string; reason: SandboxResumeReason }) {
    const sandbox = await getSandbox(input.spaceId);
    if (sandbox && isSandboxUsableStatus(sandbox.status)) return { ok: true as const, status: sandbox.status, resumed: false };
    if (sandbox?.status === "provisioning") return { ok: true as const, status: sandbox.status, resumed: false, provisioning: true };
    if (sandbox?.status === "terminated") return { ok: false as const, status: sandbox.status, resumed: false, message: "sandbox is terminated" };
    if (!infra) return { ok: false as const, status: sandbox?.status ?? null, resumed: false, message: "sandbox infra adapter is not configured" };

    const result = await withLock(`sandbox:resume:${input.spaceId}`, async () => {
      const latest = await getSandbox(input.spaceId);
      if (latest && isSandboxUsableStatus(latest.status)) return { ok: true as const, status: latest.status, resumed: false };
      await db.update(spaceSandboxes).set({
        status: "provisioning",
        runtimeStatus: "starting",
        stoppedAt: null,
        stopReason: null,
        meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify({ resumeReason: input.reason, resumeStartedAt: new Date().toISOString() })}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(spaceSandboxes.spaceId, input.spaceId));
      await infra.resumeSandbox(input);
      return { ok: true as const, status: "provisioning", resumed: true };
    });
    return "locked" in result ? { ok: true as const, status: sandbox?.status ?? "provisioning", resumed: false, recovering: true } : result;
  }

  async function stopSandbox(input: { spaceId: string; reason: SandboxStopReason; podName?: string | null; at?: Date }) {
    if (!infra) throw new Error("sandbox infra adapter is not configured");
    const at = input.at ?? nowDate();
    const sandbox = await getSandbox(input.spaceId);
    if (!sandbox) return { ok: false as const, status: null, message: "sandbox not found" };
    if (sandbox.status === "stopped") return { ok: true as const, status: "stopped", skipped: true };
    if (!isSandboxUsableStatus(sandbox.status)) return { ok: true as const, status: sandbox.status, skipped: true };
    const podName = input.podName ?? sandbox.podName ?? `sandbox-${input.spaceId}`;

    const result = await withLock(`sandbox:stop:${input.spaceId}`, async () => {
      await db.update(spaceSandboxes).set({
        status: "stopping",
        runtimeStatus: "unknown",
        meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify({ stopReason: input.reason, stoppingStartedAt: at.toISOString() })}::jsonb`,
        updatedAt: at,
      }).where(eq(spaceSandboxes.spaceId, input.spaceId));

      await infra.deletePod({ podName });
      const deleted = await infra.waitForPodDeleted({ podName, timeoutMs: 120_000 });
      if (!deleted) throw new Error(`timed out waiting for sandbox pod deletion: ${podName}`);

      const stoppedAt = nowDate();
      const [updated] = await db.update(spaceSandboxes).set({
        status: "stopped",
        runtimeStatus: "unknown",
        podName: null,
        stoppedAt,
        stopReason: input.reason,
        meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify({ stoppedAt: stoppedAt.toISOString(), stopReason: input.reason })}::jsonb`,
        updatedAt: stoppedAt,
      }).where(eq(spaceSandboxes.spaceId, input.spaceId)).returning();
      return { ok: true as const, status: updated?.status ?? "stopped", stoppedAt };
    });
    return "locked" in result ? { ok: true as const, status: sandbox.status, skipped: true, locked: true } : result;
  }

  async function reapIdleSandboxes(input: { idleTtlMs?: number; limit?: number; now?: Date } = {}) {
    const idleTtlMs = input.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    const now = input.now ?? nowDate();
    const cutoff = new Date(now.getTime() - idleTtlMs);
    const limit = input.limit ?? DEFAULT_REAPER_LIMIT;
    const candidates = await db.select().from(spaceSandboxes).where(and(
      inArray(spaceSandboxes.status, [...RUNNING_STATUSES]),
      or(
        lt(spaceSandboxes.lastActivityAt, cutoff),
        and(isNull(spaceSandboxes.lastActivityAt), lt(spaceSandboxes.lastHeartbeatAt, cutoff)),
        and(isNull(spaceSandboxes.lastActivityAt), isNull(spaceSandboxes.lastHeartbeatAt), lt(spaceSandboxes.createdAt, cutoff)),
      ),
    )).orderBy(asc(spaceSandboxes.lastActivityAt), asc(spaceSandboxes.createdAt)).limit(limit);

    const stopped: Array<{ spaceId: string; status: string }> = [];
    const skipped: Array<{ spaceId: string; status: string; reason: string }> = [];
    const failed: Array<{ spaceId: string; error: string }> = [];

    for (const sandbox of candidates) {
      if (!isIdleCandidate(sandbox, { now, idleTtlMs })) {
        skipped.push({ spaceId: sandbox.spaceId, status: sandbox.status, reason: "not_idle" });
        continue;
      }
      try {
        const result = await stopSandbox({ spaceId: sandbox.spaceId, reason: "idle", podName: sandbox.podName, at: now });
        if (result.ok) stopped.push({ spaceId: sandbox.spaceId, status: result.status ?? "unknown" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ spaceId: sandbox.spaceId, error: message });
        logger.error(`[SandboxReaper] failed to stop idle sandbox spaceId=${sandbox.spaceId}: ${message}`);
        await db.update(spaceSandboxes).set({
          status: "error",
          meta: sql`coalesce(${spaceSandboxes.meta}, '{}'::jsonb) || ${JSON.stringify({ lastIdleStopError: message, lastIdleStopFailedAt: new Date().toISOString() })}::jsonb`,
          updatedAt: new Date(),
        }).where(eq(spaceSandboxes.spaceId, sandbox.spaceId)).catch(() => undefined);
      }
    }

    return { scanned: candidates.length, stopped, skipped, failed };
  }

  return {
    getSandbox,
    recordActivity,
    recordHeartbeat,
    ensureRunning,
    stopSandbox,
    reapIdleSandboxes,
  };
}
