import assert from "node:assert/strict";
import {
  REALTIME_MESSAGE_META_KEYS,
  pickRealtimeMessageMeta,
} from "../realtime-message-meta.js";

// Regression: session.message.persisted realtime events must carry
// messageOrdinal so the web client's intermediate-message dedupe (keyed by
// `ordinal:N`) matches the REST stream-snapshot path. Dropping it caused
// each_key_duplicate crashes and a frozen streaming UI until finalize.
function testOrdinalWhitelisted() {
  assert.ok(
    REALTIME_MESSAGE_META_KEYS.includes("messageOrdinal"),
    "messageOrdinal must be whitelisted for realtime broadcast",
  );

  const picked = pickRealtimeMessageMeta({
    messageKind: "assistant_intermediate",
    turnId: "turn-1",
    messageOrdinal: 7,
    // fields outside the whitelist must be dropped
    rawStopReason: "tool_use",
    thinking: "should not leak",
    toolCallRenderStates: [{ id: "x" }],
  });

  assert.deepEqual(picked, {
    messageKind: "assistant_intermediate",
    turnId: "turn-1",
    messageOrdinal: 7,
  });
}

// ordinal === 0 is a valid ordinal (first assistant message) and must survive.
function testZeroOrdinalSurvives() {
  const picked = pickRealtimeMessageMeta({ messageOrdinal: 0 });
  assert.deepEqual(picked, { messageOrdinal: 0 });
}

// null meta and empty-after-filter meta return null.
function testEmptyReturnsNull() {
  assert.equal(pickRealtimeMessageMeta(null), null);
  assert.equal(pickRealtimeMessageMeta(undefined), null);
  assert.equal(pickRealtimeMessageMeta({ notWhitelisted: 1 }), null);
}

// undefined ordinal is simply omitted (not serialized as undefined).
function testUndefinedOrdinalOmitted() {
  const picked = pickRealtimeMessageMeta({
    messageKind: "assistant_final",
    messageOrdinal: undefined,
  });
  assert.deepEqual(picked, { messageKind: "assistant_final" });
}

testOrdinalWhitelisted();
testZeroOrdinalSurvives();
testEmptyReturnsNull();
testUndefinedOrdinalOmitted();
