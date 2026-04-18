import { Redis } from "ioredis";
import { AGENT_INSTANCE_HEARTBEAT_MS, env, SPACE_OWNER_LEASE_MS } from "./env.js";

const redis = new Redis(env.REDIS_URL);

export type AgentInstanceRecord = {
  instanceId: string;
  podName: string;
  hostname: string;
  status: "ready" | "degraded" | "stopping";
  startedAt: number;
  lastHeartbeatAt: number;
  version?: string;
};

export type SpaceOwnerLease = {
  spaceId: string;
  ownerId: string;
  leaseUntil: number;
  epoch: number;
  claimedAt: number;
  updatedAt: number;
};

export function getAgentInstanceKey(instanceId: string) {
  return `agent:instance:${instanceId}`;
}

export function getAgentInstanceInputQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:input_queue`;
}

export function getAgentInstanceProcessingQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:processing_queue`;
}

export function getAgentInstanceDeadLetterQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:dead_letter_queue`;
}

export function getSpaceOwnerKey(spaceId: string) {
  return `agent:space_owner:${spaceId}`;
}

export function getSpaceRuntimeKey(spaceId: string) {
  return `agent:space_runtime:${spaceId}`;
}

export async function heartbeatAgentInstance(status: AgentInstanceRecord["status"] = "ready") {
  const now = Date.now();
  const payload: AgentInstanceRecord = {
    instanceId: env.AGENT_INSTANCE_ID,
    podName: process.env.HOSTNAME?.trim() || env.AGENT_INSTANCE_ID,
    hostname: process.env.HOSTNAME?.trim() || env.AGENT_INSTANCE_ID,
    status,
    startedAt: Number(process.env.AGENT_STARTED_AT ?? now),
    lastHeartbeatAt: now,
    version: env.AGENT_VERSION,
  };

  const ttlSeconds = Math.max(1, Math.ceil((AGENT_INSTANCE_HEARTBEAT_MS * 3) / 1000));
  await redis.set(getAgentInstanceKey(env.AGENT_INSTANCE_ID), JSON.stringify(payload), "EX", ttlSeconds);
}

export async function listActiveAgentInstances(): Promise<AgentInstanceRecord[]> {
  const keys = await redis.keys("agent:instance:*");
  if (keys.length === 0) return [];
  const values = await redis.mget(keys);
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

export function startAgentInstanceHeartbeatLoop() {
  void heartbeatAgentInstance("ready").catch((error) => {
    console.error("[Ownership] Initial agent heartbeat failed:", error);
  });

  return setInterval(() => {
    void heartbeatAgentInstance("ready").catch((error) => {
      console.error("[Ownership] Agent heartbeat failed:", error);
    });
  }, AGENT_INSTANCE_HEARTBEAT_MS);
}

export async function getSpaceOwner(spaceId: string): Promise<SpaceOwnerLease | null> {
  const raw = await redis.get(getSpaceOwnerKey(spaceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SpaceOwnerLease;
  } catch {
    return null;
  }
}

export async function claimSpaceOwner(spaceId: string): Promise<SpaceOwnerLease> {
  const key = getSpaceOwnerKey(spaceId);
  const now = Date.now();
  const leaseUntil = now + SPACE_OWNER_LEASE_MS;

  const result = await redis.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local now = tonumber(ARGV[2])
local leaseUntil = tonumber(ARGV[3])

local raw = redis.call('GET', key)
if not raw then
  local payload = cjson.encode({
    spaceId = ARGV[4],
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
    env.AGENT_INSTANCE_ID,
    String(now),
    String(leaseUntil),
    spaceId,
  );

  return JSON.parse(String(result)) as SpaceOwnerLease;
}

export async function renewSpaceOwner(spaceId: string, epoch: number): Promise<boolean> {
  const key = getSpaceOwnerKey(spaceId);
  const now = Date.now();
  const leaseUntil = now + SPACE_OWNER_LEASE_MS;

  const result = await redis.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local epoch = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local leaseUntil = tonumber(ARGV[4])

local raw = redis.call('GET', key)
if not raw then
  return 0
end

local decoded = cjson.decode(raw)
if decoded.ownerId ~= ownerId then
  return 0
end
if tonumber(decoded.epoch or 0) ~= epoch then
  return 0
end

decoded.leaseUntil = leaseUntil
decoded.updatedAt = now
redis.call('SET', key, cjson.encode(decoded))
return 1
    `,
    1,
    key,
    env.AGENT_INSTANCE_ID,
    String(epoch),
    String(now),
    String(leaseUntil),
  );

  return Number(result) === 1;
}

export async function resolveOrClaimSpaceOwner(spaceId: string): Promise<SpaceOwnerLease> {
  const existing = await getSpaceOwner(spaceId);
  const now = Date.now();
  if (existing && existing.leaseUntil > now) return existing;
  return claimSpaceOwner(spaceId);
}

export async function updateSpaceRuntime(input: {
  spaceId: string;
  status: "idle" | "connecting" | "preparing" | "ready" | "error";
  sandboxId?: string | null;
  preparedAt?: number | null;
  error?: string | null;
}) {
  const key = getSpaceRuntimeKey(input.spaceId);
  const existingRaw = await redis.get(key);
  const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
  const next = {
    ...existing,
    spaceId: input.spaceId,
    ownerId: env.AGENT_INSTANCE_ID,
    status: input.status,
    sandboxId: input.sandboxId ?? existing.sandboxId ?? null,
    preparedAt: input.preparedAt ?? existing.preparedAt ?? null,
    error: input.error ?? null,
    updatedAt: Date.now(),
  };
  await redis.set(key, JSON.stringify(next), "EX", Math.max(30, Math.ceil((SPACE_OWNER_LEASE_MS * 4) / 1000)));
}

export async function closeOwnershipRedis() {
  await redis.quit().catch(() => redis.disconnect());
}
