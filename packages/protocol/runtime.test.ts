import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeClientFrameSchema, runtimeCommandSchema, runtimeReadySchema, parseRuntimeRegistration, contextToPiMessages, contextToTranscript } from "./src/runtime/index.js";
import { getSessionStreamSnapshotKey, SESSION_STREAM_SNAPSHOT_CLEAR_TURN_LUA } from "./src/realtime/index.js";

test("Shared stream snapshot clearing targets one Session and one turn", () => {
  assert.equal(getSessionStreamSnapshotKey("space", "session"), "session:stream:snapshot:space:session");
  // The Lua guard must compare the stored turnId so a delayed older turn cannot drop live state.
  assert.match(SESSION_STREAM_SNAPSHOT_CLEAR_TURN_LUA, /snapshot\.turnId == ARGV\[1\]/);
  assert.match(SESSION_STREAM_SNAPSHOT_CLEAR_TURN_LUA, /redis\.call\('DEL', KEYS\[1\]\)/);
});

test("Runtime protocol validates execution identities, native archive versions and capabilities", () => {
  assert.equal(runtimeCommandSchema.safeParse({ type: "turn.abort", requestId: "arbitrary" }).success, false);
  assert.equal(runtimeClientFrameSchema.safeParse({ type: "runtime.hello", version: 2, spaceId: crypto.randomUUID(), token: "token", capabilities: { harnesses: ["pi"], models: [] } }).success, false);
  assert.equal(runtimeClientFrameSchema.safeParse({ type: "runtime.hello", version: 1, spaceId: crypto.randomUUID(), token: "token", capabilities: { harnesses: ["pi"], models: [] } }).success, true);
});

test("Runtime registration parsing fails closed for corrupt and incompatible Redis values", () => {
  const registration = { connectionId: crypto.randomUUID(), ownerUserId: "owner", endpoint: "ws://gateway/internal/runtime-relay/space", capabilities: { harnesses: ["pi"], models: [] } };
  assert.deepEqual(parseRuntimeRegistration(JSON.stringify(registration)), registration);
  for (const raw of ["{", "null", "[]", "42", JSON.stringify({ capabilities: registration.capabilities }), JSON.stringify({ ...registration, connectionId: "bad" }), JSON.stringify({ ...registration, endpoint: "https://example.com" }), JSON.stringify({ ...registration, capabilities: { harnesses: ["unknown"], models: [] } })]) {
    assert.equal(parseRuntimeRegistration(raw), null);
  }
});

test("Runtime ready requires a valid connection identity", () => {
  assert(runtimeReadySchema.safeParse({ type: "runtime.ready", connectionId: crypto.randomUUID() }).success);
  for (const connectionId of [undefined, null, "", "invalid", 1]) {
    assert.equal(runtimeReadySchema.safeParse({ type: "runtime.ready", connectionId }).success, false);
  }
});

test("Context compiler preserves tool pairing and transcript content without executing anything", () => {
  const messages = [{ id: "message", turnId: "turn", role: "assistant" as const, content: [
    { type: "tool_use" as const, id: "tool", name: "bash", input: { command: "echo historical" } },
    { type: "tool_result" as const, tool_use_id: "tool", content: "historical result", is_error: false },
  ] }];
  const pi = contextToPiMessages(messages);
  assert.equal(pi[0]?.role, "assistant");
  assert.equal(pi[1]?.role, "toolResult");
  assert.equal(pi[1]?.toolCallId, "tool");
  assert(contextToTranscript(messages).includes("historical result"));
});
