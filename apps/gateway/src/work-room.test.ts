import assert from "node:assert/strict";
import { test } from "node:test";
import type { Redis } from "ioredis";
import type { RealtimeRoomDescriptor } from "@cohub/protocol/realtime";
import {
  WORK_ROOM_MAX_PRESENCE_RATE,
  consumeWorkRoomPresenceRate,
  renewWorkRoomMembership,
  sweepWorkRoomLeases,
} from "./work-room.js";

const room = { id: "room-1", code: "DEMO", createdAt: "", expiresAt: "", maxParticipants: 8 } as unknown as RealtimeRoomDescriptor;

const connection = () => ({
  connectionId: "connection-1",
  userId: "user-1",
  token: "token-1",
  workRooms: new Map([["room-1", { participantId: "participant-1", ticket: "ticket-1", room }]]),
});

const evalStub = (result: number) => ({ eval: async () => result }) as unknown as Redis;

test("renewing a Work room membership distinguishes expiry from revocation", async () => {
  const active = connection();
  assert.equal(await renewWorkRoomMembership(active, "room-1", evalStub(1)), "active");
  assert.equal(active.workRooms.size, 1, "an active lease keeps the membership");

  // -2 means the room itself expired; nobody is left to notify.
  const expired = connection();
  assert.equal(await renewWorkRoomMembership(expired, "room-1", evalStub(-2)), "expired");
  assert.equal(expired.workRooms.size, 0);

  // -1 means the room outlived our membership, so peers still need an update.
  const revoked = connection();
  assert.equal(await renewWorkRoomMembership(revoked, "room-1", evalStub(-1)), "revoked");
  assert.equal(revoked.workRooms.size, 0);
});

test("renewing an unknown Work room reports revocation without touching Redis", async () => {
  const ctx = { connectionId: "connection-1", workRooms: new Map() };
  const redis = { eval: async () => assert.fail("must not query Redis") } as unknown as Redis;
  assert.equal(await renewWorkRoomMembership(ctx, "room-404", redis), "revoked");
});

test("Work room presence admission enforces and resets its rate window", () => {
  const rate = { startedAt: 1_000, count: 0 };
  for (let index = 0; index < WORK_ROOM_MAX_PRESENCE_RATE; index += 1) {
    assert.equal(consumeWorkRoomPresenceRate(rate, 1_500), true);
  }
  assert.equal(consumeWorkRoomPresenceRate(rate, 1_500), false, "the window must reject once its budget is spent");
  assert.equal(consumeWorkRoomPresenceRate(rate, 2_000), true, "a later window starts fresh");
  assert.deepEqual(rate, { startedAt: 2_000, count: 1 });
});

test("sweeping Work room leases announces every claimed participant once", async () => {
  const published: string[] = [];
  const redis = {
    eval: async (script: string) => {
      // The sweep claims leases; every later call is a member.left announcement.
      if (published.length === 0 && script.includes("zrem")) return ["participant-2", "participant-3"];
      published.push(script);
      return 5;
    },
  } as unknown as Redis;
  const removed = await sweepWorkRoomLeases("room-1", redis);
  assert.deepEqual(removed, ["participant-2", "participant-3"]);
  assert.equal(published.length, 2, "each swept member gets its own member.left event");
});

test("sweeping Work room leases tolerates a room that expired mid-sweep", async () => {
  let swept = false;
  const redis = {
    eval: async () => {
      if (swept) return -1;
      swept = true;
      return ["participant-2"];
    },
  } as unknown as Redis;
  assert.deepEqual(await sweepWorkRoomLeases("room-1", redis), ["participant-2"]);
});
