import assert from "node:assert/strict";
import { mock, test, after } from "node:test";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, eq } from "drizzle-orm";
import * as schema from "@cohub/db";

// Opt-in isolated engine; no production DB or test dependency is required by the app.
const home = process.env.RUNTIME_TEST_DB_HOME;
if (!home) throw new Error("Set RUNTIME_TEST_DB_HOME to an isolated installation of @electric-sql/pglite and drizzle-orm");
const { PGlite } = await import(`${home}/node_modules/@electric-sql/pglite/dist/index.js`);
const { drizzle } = await import(`${home}/node_modules/drizzle-orm/pglite/index.js`);
const engine = new PGlite();
const database = drizzle(engine);
await engine.exec("create schema v2");
for (const table of Object.values(schema).filter((table) => is(table, PgTable))) {
  const config = getTableConfig(table);
  const columns = config.columns.map((column) => `"${column.name}" ${column.getSQLType()}${column.name === "id" && column.getSQLType() === "uuid" ? " primary key default gen_random_uuid()" : column.name === "created_at" || column.name === "updated_at" ? " default now()" : ""}`);
  await engine.exec(`create table if not exists "${config.schema}"."${config.name}" (${columns.join(",")})`);
}
await engine.exec("create unique index test_message_idempotency on v2.session_messages(session_id,idempotency_key)");
let queueUnavailable = false;
let gatewayUnavailable = false;
let rejectFinalUpdate = false;
let beforeFinalUpdate;
const wakes = [], processed = [], publications = [], gatewayCommands = [];
let gatewayTargets = [];
const db = new Proxy(database, { get(target, key) {
  if (key === "transaction") return (callback) => target.transaction((tx) => callback(new Proxy(tx, { get(transaction, method) {
    if (method === "update") return (table) => {
      if (table === schema.sessionTurns) {
        beforeFinalUpdate?.();
        if (rejectFinalUpdate) throw new Error("injected failure between message insert and terminal update");
      }
      return transaction.update(table);
    };
    const value = transaction[method]; return typeof value === "function" ? value.bind(transaction) : value;
  } })));
  const value = target[key]; return typeof value === "function" ? value.bind(target) : value;
} });
mock.module("../db.js", { exports: { db } });
mock.module("../env.js", { exports: { env: { ENV: "test" } } });
mock.module("../logger.js", { exports: { logger: { warn() {}, error() {}, debug() {} } } });
mock.module("../redis.js", { exports: {
  redis: { hget: async () => "gateway-node" }, publishRealtimeEnvelope: async (event) => { publications.push(event); }, clearPersistedSessionStreamSnapshot: async () => {}, getGatewayNodeOutboundStreamKey: () => "test",
  xaddWithMaxlen: async (_redis, _key, ...args) => { if (gatewayUnavailable) throw new Error("gateway unavailable"); gatewayCommands.push(JSON.parse(args.at(-1))); },
} });
mock.module("../queue.js", { exports: { agentTurnQueue: { add: async () => {} }, enqueueAgentTurnJob: async (job) => { if (queueUnavailable) throw new Error("queue unavailable"); wakes.push(job); } } });
mock.module("../session-message-postprocess-queue.js", { exports: { enqueueSessionMessagePostprocess: async (job) => { if (queueUnavailable) throw new Error("queue unavailable"); processed.push(job); } } });
mock.module("../session-title-queue.js", { exports: { enqueueSessionTitleGeneration: async () => {} } });
mock.module("../reference-index.js", { exports: { indexTurnReferences: () => {} } });
mock.module("../turn-object-storage.js", { exports: { buildTurnObjectPrefix: () => "test/", writeTurnObjectJson: async () => ({ sizeBytes: 0 }) } });
mock.module("../session-lock.js", { exports: { acquireSessionLock: async () => null } });
mock.module("../runtime/remote-runtime.js", { exports: { executeRemoteHarnessTurn: async () => {}, markRuntimeRecovery: async () => {} } });
const { persistAssistantMessage } = await import("../persistence.js");
const { sweepRuntimeRecovery } = await import("../runtime/recovery.js");
const { createRuntimeContextReader } = await import("../runtime/context-reader.js");
after(() => engine.close());

async function setup(resolution = false, channels = 0) {
  const spaceId = crypto.randomUUID(), sessionId = crypto.randomUUID(), turnId = crypto.randomUUID(), userMessageId = crypto.randomUUID();
  await database.insert(schema.spaceSessions).values({ id: sessionId, spaceId, meta: {} });
  await database.insert(schema.sessionTurns).values({ id: turnId, sessionId, sequence: 1, status: "running", executionKind: "agent", intent: "followup", userContent: [{ type: "text", text: "input" }], meta: { harness: "pi", ...(resolution ? { runtimeRecovery: { state: "confirmed_stopped" } } : {}) } });
  await database.insert(schema.sessionMessages).values({ id: userMessageId, sessionId, turnId, sequence: 1, role: "user", content: [{ type: "text", text: "input" }], meta: {} });
  gatewayTargets = [];
  for (let index = 0; index < channels; index++) {
    const target = { spaceChannelId: crypto.randomUUID(), provider: "discord", externalChatId: `chat-${index}`, bindingKey: `binding-${index}` };
    gatewayTargets.push(target);
    await database.insert(schema.spaceSessionBindings).values({ id: crypto.randomUUID(), spaceId, spaceSessionId: sessionId, ...target });
  }
  return { spaceId, sessionId, turnId, userMessageId };
}
const finish = (identity, resolution = false) => persistAssistantMessage({ ...identity, spaceSessionId: identity.sessionId, idempotencyKey: `final:${identity.turnId}`, messageOrdinal: 0,
  event: { message: { role: "assistant", content: [{ type: "text", text: "durable result" }], stopReason: resolution ? "aborted" : "stop", meta: { runtime: "local", messageKind: "assistant_final", ...(resolution ? { runtimeResolution: true } : {}) } } },
});
const readTurn = async (id) => (await database.select().from(schema.sessionTurns).where(eq(schema.sessionTurns.id, id)))[0];

test("resolution lookup stays bounded and validates Session and execution boundary", async () => {
  const identity = await setup();
  await database.update(schema.sessionTurns).set({ status: "completed" }).where(eq(schema.sessionTurns.id, identity.turnId));
  const history = Array.from({ length: 300 }, (_, index) => ({ id: crypto.randomUUID(), sessionId: identity.sessionId, sequence: index + 2, status: "interrupted", executionKind: "agent", userContent: [], meta: { harness: "pi", runtimeRecovery: { state: "confirmed_stopped" } } }));
  await database.insert(schema.sessionTurns).values(history);
  const foreign = await setup(true);
  const load = createRuntimeContextReader(database, async () => { throw new Error("not used"); });
  const base = { spaceId: identity.spaceId, sessionId: identity.sessionId, beforeSequence: 300, headOnly: true, harness: "pi" };
  assert.deepEqual((await load(base)).resolvedTurnIds, []);
  const normallySettled = await load({ ...base, pendingTurnIds: [identity.turnId] });
  assert.deepEqual(normallySettled.settledTurnIds, [identity.turnId]);
  assert.deepEqual(normallySettled.resolvedTurnIds, []);
  const result = await load({ ...base, pendingTurnIds: [history[0].id, foreign.turnId] });
  assert.deepEqual(result.resolvedTurnIds, [history[0].id]);
  assert(JSON.stringify(result).length < 450);
  assert.deepEqual((await load({ ...base, pendingTurnIds: [history.at(-1).id] })).resolvedTurnIds, []);
  await assert.rejects(() => load({ ...base, pendingTurnIds: history.slice(0, 3).map((turn) => turn.id) }), /Too many/);
});

test("local message insertion and terminal state roll back together", async () => {
  const identity = await setup(); rejectFinalUpdate = true;
  await assert.rejects(() => finish(identity), /injected failure/); rejectFinalUpdate = false;
  assert.equal((await readTurn(identity.turnId)).status, "running");
  assert.equal((await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.turnId, identity.turnId))).length, 1);
});

test("confirmation queued after message insertion cannot observe a half-committed final result", async () => {
  const identity = await setup();
  let confirmation;
  beforeFinalUpdate = () => {
    beforeFinalUpdate = undefined;
    // PGlite serializes connections; this competing SQL waits behind the real transaction.
    confirmation = engine.query(`update v2.session_turns set meta = meta || '{"runtimeRecovery":{"state":"confirmed_stopped"}}'::jsonb where id=$1 and status in ('running','abort_requested') returning id`, [identity.turnId]);
  };
  await finish(identity);
  assert.deepEqual((await confirmation).rows, []);
  assert.equal((await readTurn(identity.turnId)).status, "completed");
});

test("confirmation winning first rejects a late result without inserting a message", async () => {
  const identity = await setup(true);
  await assert.rejects(() => finish(identity), /manually resolved/);
  assert.equal((await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.turnId, identity.turnId))).length, 1);
});

test("channel delivery retries only failed targets with stable command identity", async () => {
  const identity = await setup(false, 2);
  let failedOnce = false;
  const originalPush = gatewayCommands.push.bind(gatewayCommands);
  gatewayCommands.push = (command) => {
    if (!failedOnce && command.externalChatId === "chat-1") { failedOnce = true; gatewayUnavailable = true; throw new Error("second target unavailable"); }
    return originalPush(command);
  };
  await finish(identity);
  gatewayUnavailable = false;
  const result = (await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.turnId, identity.turnId))).find((message) => message.role === "assistant");
  assert.equal(result.meta.runtimeDeliveryPending, true);
  await sweepRuntimeRecovery();
  const byChat = gatewayCommands.filter((command) => command?.externalChatId).reduce((map, command) => map.set(command.externalChatId, [...(map.get(command.externalChatId) ?? []), command]), new Map());
  assert.equal(byChat.get("chat-0")?.length, 1);
  assert.equal(byChat.get("chat-1")?.length, 1);
  const firstId = byChat.get("chat-0")?.[0].commandId;
  await sweepRuntimeRecovery();
  assert.equal(gatewayCommands.filter((command) => command?.externalChatId === "chat-0").length, 1);
  assert.equal(firstId?.length, 64);
});

test("queue failure after confirmed stop leaves a terminal result and retryable delivery intent", async () => {
  const identity = await setup(true); queueUnavailable = true;
  await finish(identity, true);
  assert.equal((await readTurn(identity.turnId)).status, "interrupted");
  const messages = await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.turnId, identity.turnId));
  const result = messages.find((message) => message.role === "assistant");
  assert.equal(result.meta.runtimeDeliveryPending, true);
  queueUnavailable = false;
  await sweepRuntimeRecovery();
  assert(processed.some((job) => job.messageId === result.id));
  assert(wakes.some((job) => job.sessionId === identity.sessionId && job.reason === "runtime_delivery"));
  assert.equal((await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.id, result.id)))[0].meta.runtimeDeliveryPending, undefined);
  const deliveredCount = processed.length;
  await sweepRuntimeRecovery();
  assert.equal(processed.length, deliveredCount, "delivered intents leave the sweep");
  await finish(identity, true);
  assert.equal((await database.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.turnId, identity.turnId))).length, 2);
});
