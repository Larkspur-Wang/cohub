import assert from "node:assert/strict";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  EMPTY_TOOL_CALL_LOOP_GUARD_STATE,
  getToolCallBatchFingerprint,
  observeToolCallBatch,
  TOOL_CALL_LOOP_GUARD_THRESHOLD,
  type ToolCallLoopGuardState,
} from "../runtime/tool-call-loop-guard.js";

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return { role: "assistant", content } as AssistantMessage;
}

const first = assistant([
  { type: "text", text: "Checking files" },
  { type: "toolCall", id: "call-a", name: "read", arguments: { path: "/a", offset: 1 } },
  { type: "toolCall", id: "call-b", name: "read", arguments: { path: "/b" } },
]);
const reordered = assistant([
  { type: "thinking", thinking: "A different thought" },
  { type: "toolCall", id: "call-c", name: "read", arguments: { path: "/b" } },
  { type: "toolCall", id: "call-d", name: "read", arguments: { offset: 1, path: "/a" } },
]);

assert.equal(
  getToolCallBatchFingerprint(first),
  getToolCallBatchFingerprint(reordered),
  "tool-call order, argument key order, text, thinking, and call IDs should not affect the fingerprint",
);
assert.notEqual(
  getToolCallBatchFingerprint(first),
  getToolCallBatchFingerprint(assistant([
    { type: "toolCall", id: "call-e", name: "read", arguments: { path: "/a", offset: 1 } },
  ])),
  "the complete batch, including multiplicity, should affect the fingerprint",
);

let state: ToolCallLoopGuardState = EMPTY_TOOL_CALL_LOOP_GUARD_STATE;
for (let round = 1; round <= TOOL_CALL_LOOP_GUARD_THRESHOLD; round += 1) {
  const observed = observeToolCallBatch(state, { turnId: "turn-a", message: reordered });
  state = observed.state;
  assert.equal(observed.shouldIntervene, round === TOOL_CALL_LOOP_GUARD_THRESHOLD);
}
assert.equal(state.repeatCount, 0, "intervention should restart repeat counting");

state = observeToolCallBatch(state, { turnId: "turn-a", message: reordered }).state;
state = observeToolCallBatch(state, { turnId: "turn-a", message: assistant([{ type: "text", text: "Done" }]) }).state;
assert.equal(state.repeatCount, 0, "an assistant round without tool calls should reset the streak");

state = observeToolCallBatch(state, { turnId: "turn-a", message: reordered }).state;
const nextTurn = observeToolCallBatch(state, { turnId: "turn-b", message: reordered });
assert.equal(nextTurn.state.repeatCount, 1, "a new turn should start a new streak");
assert.equal(nextTurn.shouldIntervene, false);
