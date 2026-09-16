import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readRuntimeRecovery } from "@cohub/core/sessions";
import type { RuntimeRecoveryState } from "@cohub/protocol";
import { RuntimeResultUnavailableError } from "../runtime/exchange.js";

const spaceId = crypto.randomUUID();
const dialect = new PgDialect();
const rows = new Map<string, ReturnType<typeof makeTurn>>();
const locked = new Set<string>();
const released: string[] = [], restored: string[] = [], drained: string[] = [], finalized: string[] = [];
let failFinalization = false;
let completedBeforeConfirmation = false;
function makeTurn(outcome: "saved" | "unknown" | "offline" = "unknown") {
  return { id: crypto.randomUUID(), sessionId: crypto.randomUUID(), userUuid: "owner", sequence: 1, status: "running", intent: "followup", userContent: [{ type: "text", text: "original" }], userText: "original", updatedAt: new Date(), outcome, meta: { harness: "pi", runtimeRecovery: { state: "attention", ownerUserId: "owner" } as RuntimeRecoveryState } };
}
function matches(where: SQL) {
  const values = dialect.sqlToQuery(where).params;
  return [...rows.values()].filter((row) => values.includes(row.id) && ["running", "abort_requested"].includes(row.status));
}
const db = {
  select() {
    const query = { from: () => query, innerJoin: () => query, where: (_where: SQL) => ({ groupBy: async () => [...rows.values()].some((row) => row.status === "running") ? [{ spaceId }] : [], orderBy: () => Object.assign(Promise.resolve([...rows.values()].filter((row) => ["running", "abort_requested"].includes(row.status))), { limit: async () => [] }), limit: async () => matches(_where) }) };
    return query;
  },
  update() {
    return { set: (value: { meta: SQL }) => ({ where: (where: SQL) => ({ returning: async () => {
      const patch = dialect.sqlToQuery(value.meta).params.find((param): param is string => typeof param === "string" && param.startsWith("{"));
      assert(patch);
      if (completedBeforeConfirmation) {
        completedBeforeConfirmation = false;
        for (const row of matches(where)) row.status = "completed";
      }
      const updated = matches(where);
      for (const row of updated) Object.assign(row.meta, JSON.parse(patch));
      return updated.map((row) => ({ id: row.id }));
    } }) }) };
  },
};
mock.module("../db.js", { exports: { db } });
mock.module("../session-lock.js", { exports: { acquireSessionLock: async (sessionId: string) => locked.has(sessionId) ? null : { signal: new AbortController().signal, release: async () => { released.push(sessionId); } } } });
mock.module("../persistence.js", { exports: {
  deliverRuntimeMessage: async () => {}, persistUserMessage: async () => {}, publishSessionTurnsUpdated: async () => {},
  persistAssistantMessage: async ({ turnId }: { turnId: string }) => { if (failFinalization) { failFinalization = false; throw new Error("temporary DB error"); } const turn = rows.get(turnId); assert(turn); turn.status = "interrupted"; finalized.push(turnId); },
} });
const wakeups: unknown[] = [];
mock.module("../queue.js", { exports: { agentTurnQueue: { add: async (...args: unknown[]) => { wakeups.push(args); } }, enqueueAgentTurnJob: async ({ sessionId }: { sessionId: string }) => { drained.push(sessionId); } } });
mock.module("../logger.js", { exports: { logger: { warn: () => {}, debug: () => {} } } });
mock.module("../runtime/remote-runtime.js", { exports: {
  markRuntimeRecovery: async (id: string, state: RuntimeRecoveryState) => { const row = rows.get(id); assert(row); row.meta.runtimeRecovery = { ...row.meta.runtimeRecovery, ...state }; },
  executeRemoteHarnessTurn: async (input: { recovery: boolean; batch: { ownerTurn: { id: string } } }) => {
    assert.equal(input.recovery, true, "coordinator must never dispatch execution");
    const row = rows.get(input.batch.ownerTurn.id); assert(row); restored.push(row.id);
    if (row.outcome === "offline") throw new Error("offline");
    if (row.outcome === "unknown") throw new RuntimeResultUnavailableError("no result");
    row.status = "completed";
  },
} });
const { recoverRuntime, sweepRuntimeRecovery } = await import("../runtime/recovery.js");

test("Runtime reconciliation isolates live sessions, recovers saved results and scopes confirmation", async () => {
  const live = makeTurn("saved"), saved = makeTurn("saved"), unknown = makeTurn(), later = makeTurn();
  for (const row of [live, saved, unknown, later]) rows.set(row.id, row);
  locked.add(live.sessionId);
  const result = await recoverRuntime({ spaceId });
  assert.deepEqual(result, { recovered: 1, attention: 2 });
  assert.equal(live.status, "running"); assert.equal(saved.status, "completed");
  assert.equal(restored.includes(live.id), false);
  assert.equal(readRuntimeRecovery(unknown.meta)?.state, "attention");
  assert.deepEqual(drained, [saved.sessionId]);
  restored.length = 0;
  await recoverRuntime({ spaceId, confirmation: { actorUserId: "manager", revision: "snapshot", turnIds: [unknown.id] } });
  assert.equal(unknown.status, "interrupted"); assert.equal(later.status, "running");
  assert.equal(unknown.meta.runtimeRecovery.resolvedBy, "manager");
  assert.equal(restored.includes(unknown.id), false, "manual confirmation never reads late native results");
  await recoverRuntime({ spaceId, confirmation: { actorUserId: "manager", revision: "snapshot", turnIds: [unknown.id] } });
  assert.equal(finalized.filter((id) => id === unknown.id).length, 1);
  assert(released.includes(unknown.sessionId));
});

test("durable sweeps retry after a missing disconnect event without requiring user action", async () => {
  rows.clear(); locked.clear(); wakeups.length = 0;
  const turn = makeTurn("offline"); turn.meta.runtimeRecovery.state = "executing";
  rows.set(turn.id, turn);
  await sweepRuntimeRecovery();
  assert.equal(wakeups.length, 1);
  await recoverRuntime({ spaceId });
  assert.equal(turn.meta.runtimeRecovery.state, "executing", "transport failure must not request manual intervention");
  turn.outcome = "saved";
  await sweepRuntimeRecovery();
  assert.equal(wakeups.length, 2);
  await recoverRuntime({ spaceId });
  assert.equal(turn.status, "completed");
  await sweepRuntimeRecovery();
  assert.equal(wakeups.length, 2, "settled Spaces are no longer scanned");
});

test("a result completed before confirmation is not replaced by an unknown-outcome note", async () => {
  rows.clear(); locked.clear();
  const turn = makeTurn(); rows.set(turn.id, turn);
  completedBeforeConfirmation = true;
  await recoverRuntime({ spaceId, confirmation: { actorUserId: "manager", revision: "snapshot", turnIds: [turn.id] } });
  assert.equal(turn.status, "completed");
  assert.equal(finalized.includes(turn.id), false);
});

test("confirmation survives a failure after recording the resolution and retries busy locks", async () => {
  rows.clear(); locked.clear(); restored.length = 0;
  const turn = makeTurn(); rows.set(turn.id, turn);
  const job = { spaceId, confirmation: { actorUserId: "manager", revision: "snapshot", turnIds: [turn.id] } };
  locked.add(turn.sessionId);
  assert.deepEqual(await recoverRuntime({ spaceId }), { recovered: 0, attention: 0 });
  await assert.rejects(() => recoverRuntime(job), /waiting for active execution locks/);
  assert.equal(turn.meta.runtimeRecovery.state, "attention");
  locked.clear(); failFinalization = true;
  await assert.rejects(() => recoverRuntime(job), /temporary DB error/);
  assert.equal(turn.meta.runtimeRecovery.state, "confirmed_stopped");
  assert.equal(turn.status, "running");
  await recoverRuntime({ spaceId });
  assert.equal(turn.status, "interrupted");
  assert.equal(restored.length, 0, "a saved resolution must not be replaced by a late result");
});
