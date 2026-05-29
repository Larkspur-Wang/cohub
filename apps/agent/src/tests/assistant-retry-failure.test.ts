import assert from "node:assert/strict";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const { isRetryableAssistantFailure, shouldResetAssistantRetryState } = await import("../runtime/session-runtime.js");

function assistantMessage(input: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    api: "test",
    provider: "test",
    model: "test-model",
    content: [],
    stopReason: "stop",
    usage: {},
    timestamp: Date.now(),
    ...input,
  } as AssistantMessage;
}

assert.equal(
  isRetryableAssistantFailure(assistantMessage({ content: [], stopReason: "stop" })),
  true,
  "empty successful assistant messages should be retried",
);

assert.equal(
  shouldResetAssistantRetryState(assistantMessage({ content: [], stopReason: "stop" })),
  false,
  "empty successful assistant messages should not reset retry state",
);

assert.equal(
  isRetryableAssistantFailure(assistantMessage({ content: [{ type: "text", text: "ok" }], stopReason: "stop" })),
  false,
  "non-empty successful assistant messages should not be retried",
);

assert.equal(
  shouldResetAssistantRetryState(assistantMessage({ content: [{ type: "text", text: "ok" }], stopReason: "stop" })),
  true,
  "non-empty successful assistant messages should reset retry state",
);

assert.equal(
  isRetryableAssistantFailure(assistantMessage({
    content: [],
    stopReason: "error",
    errorMessage: "provider returned 503 service unavailable",
  })),
  true,
  "retryable provider errors should still be retried",
);

assert.equal(
  isRetryableAssistantFailure(assistantMessage({ content: [], stopReason: "error", errorMessage: "invalid request" })),
  false,
  "non-retryable provider errors should not be retried",
);

console.log("assistant retry failure checks passed");
