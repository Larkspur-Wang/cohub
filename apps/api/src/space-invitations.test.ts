import assert from "node:assert/strict";
import test from "node:test";
import {
  listSpaceInvitations,
  MAX_SPACE_INVITATIONS,
  storeSpaceInvitation,
} from "./space-invitations.js";

test("lists invitations in Redis batches and removes stale index entries", async () => {
  const invitationData = new Map<string, Record<string, string>>([
    [
      "invite:inv_b",
      {
        role: "builder",
        status: "active",
        use_count: "2",
        max_uses: "5",
        created_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    [
      "invite:inv_c",
      {
        role: "guest",
        status: "revoked",
        use_count: "0",
        max_uses: "0",
        created_at: "2026-08-02T00:00:00.000Z",
      },
    ],
  ]);
  const ttls = new Map([
    ["invite:inv_b", 120],
    ["invite:inv_c", 240],
  ]);
  const scanBatches: Array<[string, string[]]> = [
    ["1", ["inv_a", "inv_b"]],
    ["0", ["inv_b", "inv_c"]],
  ];
  const scanned: Array<[string, string, string, number]> = [];
  const commands: Array<["hgetall" | "ttl", string]> = [];
  const removed: Array<[string, ...string[]]> = [];

  const client = {
    async sscan(key: string, cursor: string, count: "COUNT", size: number) {
      scanned.push([key, cursor, count, size]);
      const batch = scanBatches.shift();
      assert.ok(batch);
      return batch;
    },
    pipeline() {
      const queued: Array<["hgetall" | "ttl", string]> = [];
      const pipeline = {
        hgetall(key: string) {
          queued.push(["hgetall", key]);
          commands.push(["hgetall", key]);
          return pipeline;
        },
        ttl(key: string) {
          queued.push(["ttl", key]);
          commands.push(["ttl", key]);
          return pipeline;
        },
        async exec(): Promise<Array<[Error | null, unknown]>> {
          return queued.map(([command, key]) => [
            null,
            command === "hgetall" ? (invitationData.get(key) ?? {}) : (ttls.get(key) ?? -2),
          ]);
        },
      };
      return pipeline;
    },
    async srem(key: string, ...members: string[]) {
      removed.push([key, ...members]);
      return members.length;
    },
  };

  const invitations = await listSpaceInvitations("space-1", client);

  assert.deepEqual(
    invitations.map(({ token }) => token),
    ["inv_c", "inv_b"],
  );
  assert.equal(invitations[0]?.maxUses, null);
  assert.equal(invitations[1]?.maxUses, 5);
  assert.deepEqual(scanned, [
    ["invite:space:space-1", "0", "COUNT", 100],
    ["invite:space:space-1", "1", "COUNT", 100],
  ]);
  assert.equal(commands.filter(([command]) => command === "hgetall").length, 3);
  assert.deepEqual(removed, [["invite:space:space-1", "inv_a"]]);
});

test("passes the space invitation limit to the atomic create script", async () => {
  let evaluated: unknown[] = [];
  const result = await storeSpaceInvitation(
    {
      token: "inv_test",
      spaceId: "space-1",
      spaceName: "Research",
      creatorId: "user-1",
      role: "builder",
      maxUses: 0,
      createdAt: "2026-08-03T00:00:00.000Z",
      ttlSeconds: 3600,
    },
    {
      async eval(...args: unknown[]) {
        evaluated = args;
        return "limit_reached";
      },
    },
  );

  assert.equal(result, "limit_reached");
  assert.equal(evaluated.at(-1), String(MAX_SPACE_INVITATIONS));
});
