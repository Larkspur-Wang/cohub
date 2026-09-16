import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeRecoveryLifecycle } from "./relay/runtime-relay.js";

test("Runtime relay shutdown stops new wakeups, drains existing writes and closes once", async () => {
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const events: string[] = [];
  const lifecycle = createRuntimeRecoveryLifecycle({
    enqueue: async (spaceId) => { events.push(`enqueue:${spaceId}`); await pending; },
    close: async () => { events.push("close"); },
  });
  const wakeup = lifecycle.recover("space");
  const firstClose = lifecycle.close();
  const secondClose = lifecycle.close();
  await lifecycle.recover("ignored");
  assert.deepEqual(events, ["enqueue:space"]);
  finish();
  await Promise.all([wakeup, firstClose, secondClose]);
  assert.deepEqual(events, ["enqueue:space", "close"]);
});
