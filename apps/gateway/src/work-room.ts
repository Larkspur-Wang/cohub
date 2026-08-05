import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import {
  getRealtimeRoom,
  getRealtimeRoomLeasesKey,
  getRealtimeRoomMembersKey,
  getRealtimeRoomMetaKey,
  getRealtimeRoomRateKey,
  getRealtimeRoomSequenceKey,
  REALTIME_OUTBOUND_CHANNEL,
  type RealtimeEnvelope,
  type RealtimeRoomDescriptor,
  type RealtimeRoomMember,
} from "@cohub/protocol/realtime";
import { authorizeWorkRoom } from "./api-client.js";
import { redisCommandClient } from "./redis.js";

type RoomConnection = {
  connectionId: string;
  userId?: string;
  token?: string;
  workRooms: Map<string, { participantId: string; ticket: string; room: RealtimeRoomDescriptor }>;
};

type StoredMember = RealtimeRoomMember & { connectionId: string };

export const WORK_ROOM_MAX_PAYLOAD_BYTES = 16 * 1024;
export const WORK_ROOM_MAX_EVENT_RATE = 2_000;
export const WORK_ROOM_MEMBER_LEASE_SECONDS = 60;
export const WORK_ROOM_MAX_PENDING_OPS = 256;
export const WORK_ROOM_MAX_PRESENCE_RATE = 30;

export type WorkRoomPresenceRate = { startedAt: number; count: number };

/**
 * Presence writes touch Redis on every call, so they get a connection-level
 * window of their own. Unlike publishes there is no Redis-side rate script,
 * and unlike Board awareness they cannot be dropped silently: the caller is
 * waiting on a request ack, so an over-rate update is rejected instead.
 */
export function consumeWorkRoomPresenceRate(rate: WorkRoomPresenceRate, now = Date.now()): boolean {
  if (now - rate.startedAt >= 1_000) {
    rate.startedAt = now;
    rate.count = 1;
    return true;
  }
  rate.count += 1;
  return rate.count <= WORK_ROOM_MAX_PRESENCE_RATE;
}

/**
 * Drops members whose lease lapsed. Inlined into the scripts that gate on the
 * member set, because a capacity or authorization check is only sound if the
 * sweep happens in the same atomic call. Expects KEYS[2]=members, KEYS[3]=leases
 * and a local `now` in milliseconds.
 */
const SWEEP_EXPIRED_LEASES = `for _, participantId in ipairs(redis.call("zrangebyscore", KEYS[3], "-inf", now)) do
  redis.call("zrem", KEYS[3], participantId)
  redis.call("hdel", KEYS[2], participantId)
end`;

const JOIN_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return {-1} end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return {-2} end
${SWEEP_EXPIRED_LEASES}
local current = redis.call("hget", KEYS[2], ARGV[1])
if not current and redis.call("zcard", KEYS[3]) >= tonumber(meta.maxParticipants) then return {-3} end
local member
local isNew = 0
if current then
  member = cjson.decode(current)
else
  isNew = 1
  member = { participantId = ARGV[1], joinedAt = ARGV[4], presence = cjson.null }
end
member.connectionId = ARGV[2]
redis.call("hset", KEYS[2], ARGV[1], cjson.encode(member))
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, ARGV[1])
redis.call("pexpireat", KEYS[2], math.floor(tonumber(meta.expiresAtMs)))
redis.call("pexpireat", KEYS[3], math.floor(tonumber(meta.expiresAtMs)))
local members = {}
for _, participantId in ipairs(redis.call("zrange", KEYS[3], 0, -1)) do
  local raw = redis.call("hget", KEYS[2], participantId)
  if raw then
    local item = cjson.decode(raw)
    item.connectionId = nil
    table.insert(members, item)
  end
end
member.connectionId = nil
return {1, isNew, cjson.encode(members), cjson.encode(member)}
`;

const LEAVE_ROOM_SCRIPT = `
local raw = redis.call("hget", KEYS[1], ARGV[1])
if not raw then return 0 end
local member = cjson.decode(raw)
if member.connectionId ~= ARGV[2] then return -1 end
redis.call("hdel", KEYS[1], ARGV[1])
redis.call("zrem", KEYS[2], ARGV[1])
member.connectionId = nil
return cjson.encode(member)
`;

const RENEW_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -1 end
local member = cjson.decode(raw)
if member.connectionId ~= ARGV[2] then return -1 end
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, ARGV[1])
return 1
`;

const PRESENCE_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -3 end
local member = cjson.decode(raw)
if member.connectionId ~= ARGV[2] then return -3 end
member.presence = cjson.decode(ARGV[4])
redis.call("hset", KEYS[2], ARGV[1], cjson.encode(member))
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, ARGV[1])
return cjson.encode(member)
`;

const PUBLISH_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
${SWEEP_EXPIRED_LEASES}
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -3 end
local member = cjson.decode(raw)
if member.connectionId ~= ARGV[2] then return -3 end
local second = tostring(math.floor(now / 1000))
local count = redis.call("hincrby", KEYS[5], second, 1)
redis.call("expire", KEYS[5], 2)
if count > tonumber(ARGV[8]) then return -4 end
local sequence = redis.call("incr", KEYS[4])
redis.call("pexpireat", KEYS[4], math.floor(tonumber(meta.expiresAtMs)))
local clientEventId = cjson.null
if ARGV[9] ~= "" then clientEventId = ARGV[9] end
local envelope = {
  id = ARGV[3],
  timestamp = now,
  domain = "room",
  type = "realtime.room.event",
  rooms = { ARGV[7] },
  payload = {
    roomId = ARGV[6],
    sequence = sequence,
    event = ARGV[4],
    data = cjson.decode(ARGV[5]),
    clientEventId = clientEventId,
    sender = { participantId = ARGV[1] }
  }
}
redis.call("publish", ARGV[10], cjson.encode(envelope))
return sequence
`;

const CONTROL_EVENT_SCRIPT = `
local metaRaw = redis.call("get", KEYS[2])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local sequence = redis.call("incr", KEYS[1])
redis.call("pexpireat", KEYS[1], math.floor(tonumber(meta.expiresAtMs)))
local envelope = cjson.decode(ARGV[1])
envelope.timestamp = now
envelope.payload.sequence = sequence
redis.call("publish", ARGV[2], cjson.encode(envelope))
return sequence
`;

const toStoredMember = (raw: string): RealtimeRoomMember | null => {
  try {
    const value = JSON.parse(raw) as Partial<StoredMember>;
    if (typeof value.participantId !== "string" || typeof value.joinedAt !== "string") return null;
    return {
      participantId: value.participantId,
      joinedAt: value.joinedAt,
      presence: value.presence && typeof value.presence === "object" && !Array.isArray(value.presence)
        ? value.presence as Record<string, unknown>
        : null,
    };
  } catch {
    return null;
  }
};

const roomKeys = (roomId: string): [string, string, string, string, string] => [
  getRealtimeRoomMetaKey(roomId),
  getRealtimeRoomMembersKey(roomId),
  getRealtimeRoomLeasesKey(roomId),
  getRealtimeRoomSequenceKey(roomId),
  getRealtimeRoomRateKey(roomId),
];

const roomError = (code: number, operation: "join" | "publish" | "presence") => {
  if (code === -1) return new Error("room not found");
  if (code === -2) return new Error("room expired");
  if (code === -3) return new Error(operation === "join" ? "room is full" : "room membership is stale");
  if (code === -4) return new Error("room event rate exceeded");
  return new Error("room request failed");
};

export async function joinWorkRoom(ctx: RoomConnection, input: { roomId: string; ticket: string }, redis: Redis = redisCommandClient) {
  if (!ctx.token || !ctx.userId) throw new Error("authentication required");
  const admission = await authorizeWorkRoom({ authToken: ctx.token, roomId: input.roomId, ticket: input.ticket });
  const [metaKey, membersKey, leasesKey] = roomKeys(input.roomId);
  const result = await redis.eval(
    JOIN_ROOM_SCRIPT,
    3,
    metaKey,
    membersKey,
    leasesKey,
    admission.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
    new Date().toISOString(),
  ) as [number, number?, string?, string?];
  const code = Number(result[0]);
  if (code !== 1) throw roomError(code, "join");
  const members = JSON.parse(result[2] ?? "[]") as RealtimeRoomMember[];
  const member = toStoredMember(result[3] ?? "{}");
  if (!member) throw new Error("invalid room member");
  ctx.workRooms.set(input.roomId, { participantId: admission.participantId, ticket: input.ticket, room: admission.room });
  return { ...admission, members, member, isNew: Number(result[1]) === 1 };
}

export async function leaveWorkRoom(ctx: RoomConnection, roomId: string, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) return null;
  const result = await redis.eval(
    LEAVE_ROOM_SCRIPT,
    2,
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
  );
  ctx.workRooms.delete(roomId);
  return typeof result === "string" ? toStoredMember(result) : null;
}

export type WorkRoomMembershipStatus = "active" | "expired" | "revoked";

// Atomically claim expired leases so exactly one connection announces each
// removal, even when several are sweeping the same room concurrently.
const SWEEP_LEASES_SCRIPT = `
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call("zrangebyscore", KEYS[2], "-inf", now)
local removed = {}
for _, participantId in ipairs(expired) do
  if redis.call("zrem", KEYS[2], participantId) == 1 then
    redis.call("hdel", KEYS[1], participantId)
    table.insert(removed, participantId)
  end
end
return removed
`;

/**
 * Drops members whose lease lapsed and announces them.
 *
 * The other room scripts sweep expired leases inline, but they cannot announce
 * the removal, so peers would keep a ghost member until they rejoined. This
 * runs from the ping path, which means a room recovers even when the gateway
 * that held the member crashed without running its close handler.
 */
export async function sweepWorkRoomLeases(roomId: string, redis: Redis = redisCommandClient) {
  const result = await redis.eval(
    SWEEP_LEASES_SCRIPT,
    2,
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
  );
  const removed = Array.isArray(result) ? result.filter((value): value is string => typeof value === "string") : [];
  for (const participantId of removed) {
    // A room that expired outright has no audience left, so a failed announce
    // is not worth surfacing to the caller.
    await publishWorkRoomControlEvent({
      roomId,
      type: "realtime.room.member.left",
      payload: { roomId, member: { participantId } },
    }, redis).catch(() => undefined);
  }
  return removed;
}

export async function renewWorkRoomMembership(ctx: RoomConnection, roomId: string, redis: Redis = redisCommandClient): Promise<WorkRoomMembershipStatus> {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) return "revoked";
  const result = await redis.eval(
    RENEW_ROOM_SCRIPT,
    3,
    getRealtimeRoomMetaKey(roomId),
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
  );
  const code = Number(result);
  if (code === 1) return "active";
  ctx.workRooms.delete(roomId);
  return code === -2 ? "expired" : "revoked";
}

export async function updateWorkRoomPresence(ctx: RoomConnection, roomId: string, presence: Record<string, unknown> | null, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) throw new Error("room membership is required");
  const result = await redis.eval(
    PRESENCE_ROOM_SCRIPT,
    3,
    getRealtimeRoomMetaKey(roomId),
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
    JSON.stringify(presence),
  );
  if (typeof result !== "string") {
    if (Number(result) === -2 || Number(result) === -3) ctx.workRooms.delete(roomId);
    throw roomError(Number(result), "presence");
  }
  const member = toStoredMember(result);
  if (!member) throw new Error("invalid room member");
  return member;
}

export async function publishWorkRoomEvent(ctx: RoomConnection, input: {
  roomId: string;
  event: string;
  data: unknown;
  clientEventId?: string;
}, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(input.roomId);
  if (!membership) throw new Error("room membership is required");
  if (input.event.toLowerCase().startsWith("cohub.")) throw new Error("reserved room event name");
  const dataJson = JSON.stringify(input.data);
  if (dataJson === undefined || Buffer.byteLength(dataJson, "utf8") > WORK_ROOM_MAX_PAYLOAD_BYTES) {
    throw new Error("room event payload is too large");
  }
  const eventId = randomUUID();
  const [metaKey, membersKey, leasesKey, sequenceKey, rateKey] = roomKeys(input.roomId);
  const result = await redis.eval(
    PUBLISH_ROOM_SCRIPT,
    5,
    metaKey,
    membersKey,
    leasesKey,
    sequenceKey,
    rateKey,
    membership.participantId,
    ctx.connectionId,
    eventId,
    input.event,
    dataJson,
    input.roomId,
    getRealtimeRoom(input.roomId),
    String(WORK_ROOM_MAX_EVENT_RATE),
    input.clientEventId ?? "",
    REALTIME_OUTBOUND_CHANNEL,
  );
  const sequence = Number(result);
  if (sequence < 0) {
    if (sequence === -2 || sequence === -3) ctx.workRooms.delete(input.roomId);
    throw roomError(sequence, "publish");
  }
  return { eventId, sequence, clientEventId: input.clientEventId ?? null };
}

export async function publishWorkRoomControlEvent(input: {
  roomId: string;
  type: string;
  payload: Record<string, unknown>;
}, redis: Redis = redisCommandClient) {
  const envelope: RealtimeEnvelope = {
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "room",
    type: input.type,
    rooms: [getRealtimeRoom(input.roomId)],
    payload: input.payload,
  };
  const result = await redis.eval(
    CONTROL_EVENT_SCRIPT,
    2,
    getRealtimeRoomSequenceKey(input.roomId),
    getRealtimeRoomMetaKey(input.roomId),
    JSON.stringify(envelope),
    REALTIME_OUTBOUND_CHANNEL,
  );
  const sequence = Number(result);
  if (sequence < 0) throw roomError(sequence, "presence");
  return sequence;
}
