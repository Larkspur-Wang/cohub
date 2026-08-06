import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentToolExecutionContext, runWithToolExecutionContext } from "../tool-context.js";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";

test("space env is scoped to one turn and inherited by nested tool contexts", async () => {
  const firstTurnEnv = await runWithToolExecutionContext({
    spaceId: SPACE_ID,
    sessionId: "session-a",
    turnId: "turn-a",
    spaceEnv: { VERSION: "first" },
  }, () => runWithToolExecutionContext({
    spaceId: SPACE_ID,
    sessionId: "session-a",
    turnId: "turn-a",
    toolCallId: "tool-a",
  }, async () => getCurrentToolExecutionContext()?.spaceEnv));

  assert.deepEqual(firstTurnEnv, { VERSION: "first" });
  assert.equal(getCurrentToolExecutionContext(), null);

  const secondTurnEnv = await runWithToolExecutionContext({
    spaceId: SPACE_ID,
    sessionId: "session-a",
    turnId: "turn-b",
    spaceEnv: { VERSION: "second" },
  }, async () => getCurrentToolExecutionContext()?.spaceEnv);

  assert.deepEqual(secondTurnEnv, { VERSION: "second" });
});

test("concurrent turns in the same space keep independent env snapshots", async () => {
  const readEnv = (sessionId: string, value: string) => runWithToolExecutionContext({
    spaceId: SPACE_ID,
    sessionId,
    spaceEnv: { VALUE: value },
  }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return getCurrentToolExecutionContext()?.spaceEnv;
  });

  const [first, second] = await Promise.all([
    readEnv("session-a", "first"),
    readEnv("session-b", "second"),
  ]);

  assert.deepEqual(first, { VALUE: "first" });
  assert.deepEqual(second, { VALUE: "second" });
});
