import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../runtime/local-session-manager.js";
import { syncCloudContext } from "../runtime/cloud-context.js";
import { selectCompatibleBatch } from "../runtime/batch-policy.js";
import { createRuntimeStream } from "../stream/runtime-stream.js";
import type { RuntimeContext } from "@cohub/protocol";
import type { SessionStreamEvent } from "@cohub/protocol/realtime";

const history: RuntimeContext = {
  revision: "first", throughTurnId: "turn-1", messages: [
    { id: "user-1", turnId: "turn-1", role: "user", content: [{ type: "text", text: "historical request" }] },
    { id: "assistant-1", turnId: "turn-1", role: "assistant", content: [{ type: "text", text: "historical result" }] },
  ],
};

test("Cloud materialization restores history and appends a local Harness tail exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "cohub-cloud-restore-"));
  try {
    const manager = SessionManager.create(root, root);
    manager.newSession({ id: "test" });
    assert.equal(syncCloudContext(manager, history), true);
    assert.equal(manager.buildSessionContext().messages.length, 2);
    assert.equal(syncCloudContext(manager, history), false);
    const next: RuntimeContext = { revision: "second", throughTurnId: "turn-2", messages: [...history.messages, { id: "codex-message", turnId: "turn-2", role: "assistant", content: [{ type: "text", text: "local result" }] }] };
    assert.equal(syncCloudContext(manager, next), true);
    assert.equal(manager.buildSessionContext().messages.length, 3);
    assert.equal(syncCloudContext(manager, next), false);
    const data = manager.serializeSnapshot();
    assert(data.includes("local result"));
    await manager.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Turn batches never cross Harness, actor or configuration boundaries", () => {
  const turn = (harness: string, model = "test") => ({ userUuid: "actor", meta: { harness, model } });
  assert.equal(selectCompatibleBatch([turn("cohub"), turn("pi"), turn("cohub")]).length, 1);
  assert.equal(selectCompatibleBatch([turn("pi"), turn("pi")]).length, 1);
  assert.equal(selectCompatibleBatch([turn("cohub"), turn("cohub")]).length, 2);
  assert.equal(selectCompatibleBatch([turn("cohub"), turn("cohub", "other")]).length, 1);
});

test("Runtime stream failures recover with increasing keyframe sequences and never reject final flush", async () => {
  const events: SessionStreamEvent[] = [];
  const stream = createRuntimeStream({ spaceId: "s", sessionId: "session", turnId: "turn", userMessageId: "u" }, async (event) => {
    events.push(event);
    if (events.length === 1 || events.length === 3) throw new Error("publish failed after accepting the frame");
  });
  stream.apply({ type: "message.start", ordinal: 0 });
  stream.apply({ type: "text.delta", ordinal: 0, index: 0, kind: "text", delta: "first" });
  await stream.flush();
  stream.apply({ type: "text.delta", ordinal: 0, index: 0, kind: "text", delta: " second" });
  await stream.flush();
  assert.equal(events.length, 2);
  assert.equal(events[1]?.seq, 2); assert.equal(events[1]?.baseSeq, 0);
  assert.equal(events[1]?.snapshotContent?.[0]?.type === "text" && events[1].snapshotContent[0].text, "first second");
  stream.apply({ type: "text.delta", ordinal: 0, index: 0, kind: "text", delta: " final" });
  await stream.commit(0);
  stream.dispose();
});

test("Runtime stream batches sparse and interleaved deltas with cloud-compatible message identities", async () => {
  const published: SessionStreamEvent[] = [];
  const stream = createRuntimeStream({ spaceId: "s", sessionId: "session", turnId: "turn", userMessageId: "user" }, async (event) => { published.push(event); });
  stream.apply({ type: "message.start", ordinal: 0 });
  stream.apply({ type: "text.delta", ordinal: 0, index: 1, kind: "text", delta: "one" });
  stream.apply({ type: "text.delta", ordinal: 0, index: 1, kind: "text", delta: " two" });
  await stream.flush();
  stream.apply({ type: "message.start", ordinal: 1 });
  stream.apply({ type: "text.delta", ordinal: 1, index: 0, kind: "text", delta: "next" });
  stream.apply({ type: "text.delta", ordinal: 0, index: 1, kind: "text", delta: " three" });
  await stream.flush();
  stream.dispose();
  assert.equal(published[0]?.messageId, "turn:turn:assistant:0");
  assert.deepEqual(published[0]?.content, [{ type: "text", text: "one two", _meta: { streamIndex: 1 } }]);
  assert.equal(published[1]?.seq, 2);
  assert.equal(published[1]?.baseSeq, 1);
  assert.equal(published[2]?.messageOrdinal, 1);
  assert.equal(published[2]?.baseSeq, 0);
});
