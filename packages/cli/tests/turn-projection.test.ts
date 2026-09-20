import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HttpError, type RuntimeTurnInput } from "@neta-art/cohub";
import type { SessionTurnRecord, TurnIntermediateMessagesFile } from "@cohub/protocol";
import { ProjectionStore } from "../src/runtime/projection-store.js";
import { runtimeProjectionSource, TestRuntimeSessionStore } from "./fixtures/runtime-projection-source.js";
import { listSessionProjectionTurns } from "../src/runtime/turn-projection.js";

const sessionId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

const turn = (sequence: number, id = turnId): SessionTurnRecord => ({
  id,
  sessionId,
  sourceSessionId: sessionId,
  sourceTurnId: id,
  userUuid: null,
  sequence,
  status: "completed",
  intent: "followup",
  userContent: [{ type: "text", text: `user-${sequence}` }],
  userText: `user-${sequence}`,
  assistantContent: [{ type: "text", text: `assistant-${sequence}` }],
  assistantText: `assistant-${sequence}`,
  provider: "fixture",
  model: "test",
  stopReason: "stop",
  errorMessage: null,
  finalUsage: null,
  totalUsage: null,
  summary: null,
  intermediateIndex: null,
  intermediateSummary: null,
  harnessIndex: null,
  meta: null,
  startedAt: "2026-09-19T00:00:00.000Z",
  completedAt: "2026-09-19T00:00:01.000Z",
  durationMs: 1000,
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:01.000Z",
});

function client(turns: SessionTurnRecord[], archive: TurnIntermediateMessagesFile | Error | null = null, getError?: unknown | ((turnId: string) => unknown)) {
  return {
    session: () => ({
      turns: {
        async listPaginated(options?: { cursor?: number }) {
          const rows = turns.filter((row) => options?.cursor === undefined || row.sequence > options.cursor);
          return { turns: rows, hasMore: false, nextCursor: undefined };
        },
        async get(id: string) {
          const error = typeof getError === "function" ? getError(id) : getError;
          if (error !== undefined) throw error;
          const found = turns.find((row) => row.id === id) ?? turns[0];
          if (!found) throw new Error("missing fixture turn");
          return { turn: found };
        },
        intermediate: {
          async get() { if (archive instanceof Error) throw archive; return archive; },
          async getToolCalls() { return null; },
        },
      },
    }),
  };
}

test("Turn pagination hydrates intermediate object storage into the canonical projection", async () => {
  const archive: TurnIntermediateMessagesFile = {
    version: 1,
    spaceId: "space",
    sessionId,
    turnId,
    summary: { messageCount: 1, toolCallCount: 0 },
    messages: [{
      id: messageId,
      sessionId,
      sequence: 2,
      role: "assistant",
      content: [{ type: "text", text: "intermediate" }],
      text: "intermediate",
      provider: "fixture",
      model: "test",
      stopReason: "tool_use",
      errorMessage: null,
      usage: null,
      durationMs: 1,
      toolCallsObjectKey: null,
      meta: { turnId },
      createdAt: "2026-09-19T00:00:00.500Z",
    }],
  };
  const source = { ...turn(1), intermediateIndex: { version: 1 as const, messagesObjectKey: "turn-1.json", messagesSizeBytes: 1, toolCallsBaseObjectKey: "tool/" } };
  const result = await listSessionProjectionTurns(client([source], archive), sessionId);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.messages.map((message) => message.id), [`${turnId}:user`, messageId, `${turnId}:assistant`]);
  assert.equal(result[0]?.messages[1]?.content[0]?.type, "text");
});

test("Turn pagination respects both incremental and request context boundaries", async () => {
  const second = turn(2, "44444444-4444-4444-8444-444444444444");
  const future = turn(3, "55555555-5555-4555-8555-555555555555");
  const result = await listSessionProjectionTurns(client([turn(1), second, future]), sessionId, { afterSequence: 1, throughSequence: 2 });
  assert.deepEqual(result.map((item) => item.sequence), [2]);
});

test("final assistant projection retains Turn result metadata", async () => {
  const source = { ...turn(1), finalUsage: { input: 4, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 7, cost: null }, stopReason: "error", errorMessage: "provider failed" };
  const result = await listSessionProjectionTurns(client([source]), sessionId);
  const assistant = result[0]?.messages.at(-1);
  assert.deepEqual(assistant?.usage, source.finalUsage);
  assert.equal(assistant?.stopReason, source.stopReason);
  assert.equal(assistant?.errorMessage, source.errorMessage);
});

test("intermediate object failures stop projection instead of using incomplete history", async () => {
  const source = { ...turn(1), intermediateIndex: { version: 1 as const, messagesObjectKey: "turn-1.json", messagesSizeBytes: 1, toolCallsBaseObjectKey: "tool/" } };
  await assert.rejects(listSessionProjectionTurns(client([source], new Error("object storage unavailable")), sessionId), /object storage unavailable/);
});

test("completed generation results are not duplicated with final assistant content", async () => {
  const source = { ...turn(1), intermediateIndex: { version: 1 as const, messagesObjectKey: "turn-1.json", messagesSizeBytes: 1, toolCallsBaseObjectKey: "tool/" } };
  const archive: TurnIntermediateMessagesFile = {
    version: 1, spaceId: "space", sessionId, turnId: source.id, summary: { messageCount: 1, toolCallCount: 0 },
    messages: [{ id: "generation", sessionId, sequence: 1, role: "assistant", content: [{ type: "text", text: "assistant-1" }], text: "assistant-1", provider: "fixture", model: "test", stopReason: "stop", errorMessage: null, usage: null, durationMs: 1, toolCallsObjectKey: null, meta: { messageKind: "generation_result", generationStatus: "completed" }, createdAt: source.createdAt }],
  };
  const result = await listSessionProjectionTurns(client([source], archive), sessionId);
  assert.deepEqual(result[0]?.messages.map((message) => message.id), [`${source.id}:user`, "generation"]);
});

test("Pi append uses the current native leaf after harness execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "cohub-projection-leaf-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    const source = runtimeProjectionSource();
    const firstTurn = source.addTurn(sessionId, turnId, { sequence: 1, userContent: [{ type: "text", text: "first" }] });
    const store = new TestRuntimeSessionStore("space", join(root, "state"), undefined, source);
    const input: RuntimeTurnInput = { spaceId: "space", sessionId, turnId: "44444444-4444-4444-8444-444444444444", userMessageId: "44444444-4444-4444-8444-444444444444", harness: "pi", messages: [], accessMode: "full_access", context: { revision: "one", throughTurnId: firstTurn.id, messages: [] } };
    const first = await store.prepare(input, "/repo");
    await store.started(first.state, input.turnId);
    const harnessLeaf = "native-harness-leaf";
    await appendFile(first.state.path, `${JSON.stringify({ type: "message", id: harnessLeaf, parentId: first.state.nativeLeafId, message: { role: "assistant", content: [{ type: "text", text: "native" }] } })}\n`);
    await store.recordResult(first.state, "request", []);
    source.addTurn(sessionId, input.turnId, { sequence: 2, assistantContent: [{ type: "text", text: "completed" }] });
    await store.acknowledge(first.state, input.turnId, "two");
    const nextTurnId = "55555555-5555-4555-8555-555555555555";
    source.addTurn(sessionId, nextTurnId, { sequence: 3, userContent: [{ type: "text", text: "next" }] });
    const next = await store.prepare({ ...input, turnId: "66666666-6666-4666-8666-666666666666", userMessageId: "66666666-6666-4666-8666-666666666666", context: { revision: "three", throughTurnId: nextTurnId, messages: [] } }, "/repo");
    const rows = (await readFile(next.state.path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const appended = rows.find((row) => row.message?.content?.some((block: { text?: string }) => block.text === "next"));
    assert.equal(appended?.parentId, harnessLeaf);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("RuntimeSessionStore preserves an externally edited file and starts a new source projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "cohub-projection-safety-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    const prior = turn(1);
    const current = turn(2, "44444444-4444-4444-8444-444444444444");
    const store = new TestRuntimeSessionStore("space", join(root, "state"), undefined, client([prior, current]));
    const input: RuntimeTurnInput = {
      spaceId: "space",
      sessionId,
      turnId: current.id,
      userMessageId: current.id,
      harness: "pi",
      messages: [],
      accessMode: "full_access",
      context: { complete: true, revision: "one", throughTurnId: prior.id, messages: [] },
    };
    const first = await store.prepare(input, "/repo");
    await store.started(first.state, current.id);
    await store.acknowledge(first.state, current.id, "one");
    const original = await readFile(first.state.path, "utf8");
    await appendFile(first.state.path, "external edit\n");

    const rebuilt = await store.prepare({
      ...input,
      turnId: "55555555-5555-4555-8555-555555555555",
      userMessageId: "55555555-5555-4555-8555-555555555555",
      context: { ...input.context, revision: "two", throughTurnId: current.id },
    }, "/repo");
    assert.notEqual(rebuilt.state.path, first.state.path);
    assert.equal(await readFile(first.state.path, "utf8"), `${original}external edit\n`);
    assert.match(await readFile(rebuilt.state.path, "utf8"), /user-2/);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir;
    await rm(root, { recursive: true, force: true });
  }
});

test("ProjectionStore returns an append-only batch after validating its durable anchor", async () => {
  const first = turn(1);
  const second = turn(2, "44444444-4444-4444-8444-444444444444");
  const store = new ProjectionStore(client([first, second]));
  const input = {
    spaceId: "space",
    sessionId,
    turnId: "55555555-5555-4555-8555-555555555555",
    nativeSessionId: "native",
    cwd: "/repo",
    target: "pi" as const,
    throughTurnId: second.id,
  };
  const initial = await store.project({ ...input, cursor: null });
  const cursor = await store.cursorForTurn(sessionId, first.id);
  assert(cursor);
  const append = await store.project({ ...input, cursor });
  assert.equal(initial.append, false);
  assert.equal(append.append, true);
  assert.deepEqual(append.turns.map((item) => item.id), [second.id]);
  assert.equal(append.projection.records.some((record) => record.sourceTurnId === null), false);

  const offline = new ProjectionStore(client([first, second], null, new Error("network unavailable")));
  await assert.rejects(offline.project({ ...input, cursor }), /network unavailable/);

  const missing = new ProjectionStore(client([first, second], null, (id) => id === first.id ? new HttpError("missing", 404, null) : undefined));
  const rebuilt = await missing.project({ ...input, cursor });
  assert.equal(rebuilt.append, false);
  assert.equal(rebuilt.turns.length, 2);
});

test("empty rebuild clears the old cursor so later history is not skipped", async () => {
  const boundary = turn(2, "44444444-4444-4444-8444-444444444444");
  const turns = [boundary];
  const missingAnchor = "77777777-7777-4777-8777-777777777777";
  const store = new ProjectionStore(client(turns, null, (id) => id === missingAnchor ? new HttpError("missing", 404, null) : undefined));
  const input = { spaceId: "space", sessionId, turnId: boundary.id, nativeSessionId: "native", cwd: "/repo", target: "pi" as const, throughTurnId: boundary.id };
  const rebuilt = await store.project({ ...input, cursor: { throughSequence: 1, throughTurnId: missingAnchor, sourceFingerprint: "old" } });
  assert.equal(rebuilt.append, false);
  assert.deepEqual(rebuilt.turns, []);
  assert.deepEqual(rebuilt.cursor, { throughSequence: null, throughTurnId: null, sourceFingerprint: null });

  turns.unshift(turn(1));
  const next = await store.project({ ...input, cursor: rebuilt.cursor });
  assert.deepEqual(next.turns.map((item) => item.sequence), [1]);
});
