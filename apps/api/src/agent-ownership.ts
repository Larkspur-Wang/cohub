import { redisCommandClient } from "./redis.js";

export type AgentInstanceRecord = {
  instanceId: string;
  podName: string;
  hostname: string;
  status: "ready" | "degraded" | "stopping";
  startedAt: number;
  lastHeartbeatAt: number;
  version?: string;
};

export type SessionOwnerLease = {
  spaceId: string;
  sessionId: string;
  ownerId: string;
  leaseUntil: number;
  epoch: number;
  claimedAt: number;
  updatedAt: number;
};

const DEFAULT_OWNER_ID = process.env.DEFAULT_AGENT_INSTANCE_ID ?? process.env.HOSTNAME?.trim() ?? "agent-default";
const SESSION_OWNER_LEASE_MS = Number(process.env.SESSION_OWNER_LEASE_MS ?? 20000);

export function getSessionOwnerKey(spaceId: string, sessionId: string) {
  return `agent:session_owner:${spaceId}:${sessionId}`;
}

export function getAgentInstanceKey(instanceId: string) {
  return `agent:instance:${instanceId}`;
}

export async function listActiveAgentInstances(): Promise<AgentInstanceRecord[]> {
  const keys = await redisCommandClient.keys("agent:instance:*");
  if (keys.length === 0) return [];
  const values = await redisCommandClient.mget(keys);
  const now = Date.now();
  return values
    .map((raw) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AgentInstanceRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is AgentInstanceRecord => {
      return item !== null && item.lastHeartbeatAt <= now && item.status !== "stopping";
    })
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

function chooseOwnerInstance(instances: AgentInstanceRecord[], keySeed: string) {
  if (instances.length === 0) return DEFAULT_OWNER_ID;
  let hash = 0;
  for (let i = 0; i < keySeed.length; i++) {
    hash = ((hash << 5) - hash + keySeed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % instances.length;
  return instances[idx]?.instanceId ?? DEFAULT_OWNER_ID;
}

export async function getSessionOwner(spaceId: string, sessionId: string): Promise<SessionOwnerLease | null> {
  const raw = await redisCommandClient.get(getSessionOwnerKey(spaceId, sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionOwnerLease;
  } catch {
    return null;
  }
}

export async function claimSessionOwner(spaceId: string, sessionId: string, ownerId = DEFAULT_OWNER_ID): Promise<SessionOwnerLease> {
  const key = getSessionOwnerKey(spaceId, sessionId);
  const now = Date.now();
  const leaseUntil = now + SESSION_OWNER_LEASE_MS;

  const result = await redisCommandClient.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local now = tonumber(ARGV[2])
local leaseUntil = tonumber(ARGV[3])

local raw = redis.call('GET', key)
if not raw then
  local payload = cjson.encode({
    spaceId = ARGV[4],
    sessionId = ARGV[5],
    ownerId = ownerId,
    leaseUntil = leaseUntil,
    epoch = 1,
    claimedAt = now,
    updatedAt = now
  })
  redis.call('SET', key, payload)
  return payload
end

local decoded = cjson.decode(raw)
if tonumber(decoded.leaseUntil or 0) <= now or decoded.ownerId == ownerId then
  local nextEpoch = tonumber(decoded.epoch or 0)
  if decoded.ownerId ~= ownerId then
    nextEpoch = nextEpoch + 1
  end
  decoded.ownerId = ownerId
  decoded.leaseUntil = leaseUntil
  decoded.epoch = nextEpoch
  decoded.updatedAt = now
  if not decoded.claimedAt then decoded.claimedAt = now end
  local payload = cjson.encode(decoded)
  redis.call('SET', key, payload)
  return payload
end

return raw
    `,
    1,
    key,
    ownerId,
    String(now),
    String(leaseUntil),
    spaceId,
    sessionId,
  );

  return JSON.parse(String(result)) as SessionOwnerLease;
}

export async function resolveOrClaimSessionOwner(spaceId: string, sessionId: string, ownerId?: string): Promise<SessionOwnerLease> {
  const existing = await getSessionOwner(spaceId, sessionId);
  const now = Date.now();
  if (existing && existing.leaseUntil > now) return existing;

  const resolvedOwnerId = ownerId ?? chooseOwnerInstance(await listActiveAgentInstances(), `${spaceId}:${sessionId}`);
  return claimSessionOwner(spaceId, sessionId, resolvedOwnerId);
}
