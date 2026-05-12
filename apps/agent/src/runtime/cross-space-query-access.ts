import { redis } from "../redis.js";
import { checkSpaceQueryAccess } from "../api.js";

export type CrossSpaceQueryAccess = {
  exists: boolean;
  allowed: boolean;
  workspaceReady: boolean;
  bootstrapStatus: string | null;
};

const KEY_PREFIX = "agent:cross-space-query-access:v1";
const pending = new Map<string, Promise<CrossSpaceQueryAccess>>();

function cacheKey(actorUserId: string, spaceId: string) {
  return `${KEY_PREFIX}:${actorUserId}:${spaceId}`;
}

function ttlFor(status: CrossSpaceQueryAccess) {
  if (!status.exists) return 10;
  if (!status.allowed) return 10;
  if (!status.workspaceReady) return 10;
  return 30;
}

function parseCached(raw: string | null): CrossSpaceQueryAccess | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CrossSpaceQueryAccess>;
    if (typeof value.exists !== "boolean") return null;
    if (typeof value.allowed !== "boolean") return null;
    if (typeof value.workspaceReady !== "boolean") return null;
    return {
      exists: value.exists,
      allowed: value.allowed,
      workspaceReady: value.workspaceReady,
      bootstrapStatus: typeof value.bootstrapStatus === "string" ? value.bootstrapStatus : null,
    };
  } catch {
    return null;
  }
}

export async function getCrossSpaceQueryAccess(input: {
  actorUserId: string;
  spaceId: string;
}): Promise<CrossSpaceQueryAccess> {
  const key = cacheKey(input.actorUserId, input.spaceId);
  const cached = parseCached(await redis.get(key).catch(() => null));
  if (cached) return cached;

  const existing = pending.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const result = await checkSpaceQueryAccess({ spaceId: input.spaceId, userId: input.actorUserId });
    const status: CrossSpaceQueryAccess = {
      exists: Boolean(result?.exists),
      allowed: Boolean(result?.allowed),
      workspaceReady: Boolean(result?.workspaceReady),
      bootstrapStatus: typeof result?.bootstrapStatus === "string" ? result.bootstrapStatus : null,
    };
    await redis.set(key, JSON.stringify(status), "EX", ttlFor(status)).catch(() => undefined);
    return status;
  })();

  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}

export function assertCrossSpaceQueryAccess(status: CrossSpaceQueryAccess, spaceId: string) {
  if (!status.exists) throw new Error(`Space not found: ${spaceId}`);
  if (!status.allowed) throw new Error(`Access denied: missing file.view permission for space ${spaceId}.`);
  if (status.bootstrapStatus === "failed") throw new Error(`Workspace setup failed for space ${spaceId}.`);
  if (!status.workspaceReady) throw new Error(`Workspace is not ready for space ${spaceId} yet.`);
}
