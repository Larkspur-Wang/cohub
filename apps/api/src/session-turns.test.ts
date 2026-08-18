import assert from "node:assert/strict";
import { test } from "node:test";
import { toTurnIndexItem } from "./session-turns.js";

test("toTurnIndexItem preserves executionKind", () => {
  const timestamp = new Date("2026-08-18T00:00:00.000Z");
  const item = toTurnIndexItem({
    id: "turn-1",
    sessionId: "session-1",
    sequence: 1,
    executionKind: "direct_generation",
    status: "running",
    intent: "followup",
    userUuid: null,
    startedAt: timestamp,
    completedAt: null,
    durationMs: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    userText: "Create audio",
    assistantText: null,
    provider: null,
    model: "higgs-tts",
    finalUsage: null,
    totalUsage: null,
    errorMessage: null,
  });

  assert.equal(item.executionKind, "direct_generation");
});
