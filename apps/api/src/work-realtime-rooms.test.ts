import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import {
  WORK_ROOM_MAX_ACTIVE_PER_WORK,
  WORK_ROOM_MAX_EXPIRES_IN_SECONDS,
  WORK_ROOM_MAX_PARTICIPANTS,
  WorkRoomError,
  createWorkRoom,
  normalizeWorkRoomCode,
  normalizeWorkRoomOptions,
} from "./work-realtime-rooms.js";

test("normalizes Work room codes without making them case-sensitive", () => {
  assert.equal(normalizeWorkRoomCode("  team-alpha "), "TEAM-ALPHA");
  assert.equal(normalizeWorkRoomCode("a_b2"), "A_B2");
  assert.equal(normalizeWorkRoomCode("a"), null);
  assert.equal(normalizeWorkRoomCode("room name"), null);
});

test("validates the absolute room lifetime and capacity limits", () => {
  assert.deepEqual(
    normalizeWorkRoomOptions({ code: "demo", expiresInSeconds: 3_600, maxParticipants: 64 }),
    { code: "DEMO", expiresInSeconds: 3_600, maxParticipants: 64 },
  );
  assert.throws(
    () => normalizeWorkRoomOptions({ expiresInSeconds: WORK_ROOM_MAX_EXPIRES_IN_SECONDS + 1 }),
    /expiresInSeconds/,
  );
  assert.throws(
    () => normalizeWorkRoomOptions({ maxParticipants: WORK_ROOM_MAX_PARTICIPANTS + 1 }),
    /maxParticipants/,
  );
});

const evalStub = (results: number[]) => {
  const calls: unknown[][] = [];
  const redis = {
    eval: async (...args: unknown[]) => {
      calls.push(args);
      return results[calls.length - 1] ?? 0;
    },
  } as unknown as Redis;
  return { redis, calls };
};

test("surfaces the per-Work active room quota instead of retrying codes", async () => {
  const { redis, calls } = evalStub([-1]);
  await assert.rejects(
    () => createWorkRoom({ workId: "work-1", redis }),
    (error: unknown) => {
      assert.ok(error instanceof WorkRoomError);
      assert.equal(error.code, "ROOM_QUOTA_EXCEEDED");
      assert.match(error.message, new RegExp(String(WORK_ROOM_MAX_ACTIVE_PER_WORK)));
      return true;
    },
  );
  assert.equal(calls.length, 1, "quota rejection must not burn code-allocation retries");
});

test("passes the quota limit, room index key and millisecond expiry into the create script", async () => {
  const { redis, calls } = evalStub([1]);
  const room = await createWorkRoom({ workId: "work-1", code: "demo", redis });
  assert.equal(room.code, "DEMO");
  const [, keyCount, , , indexKey, roomId, , expiresAt, quota] = calls[0] as [string, number, string, string, string, string, string, string, string];
  assert.equal(keyCount, 3);
  assert.equal(indexKey, "cohub:realtime-room:v1:work:work-1:rooms");
  assert.equal(roomId, room.id);
  assert.equal(quota, String(WORK_ROOM_MAX_ACTIVE_PER_WORK));
  // PXAT millisecond precision keeps a natural expiry distinguishable from a
  // vanished room, so the value must not be truncated to whole seconds.
  assert.equal(expiresAt, String(Date.parse(room.expiresAt)));
});
