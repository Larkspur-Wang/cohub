import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpaceHookTaskId,
  isReentrantSpaceHookEvent,
  maybeEnqueueSpaceHookTask,
} from "./index.js";

test("buildSpaceHookTaskId is stable for the same event", () => {
  const a = buildSpaceHookTaskId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  const b = buildSpaceHookTaskId({
    spaceId: "space-1",
    eventId: "event-1",
    eventType: "space.fs.changed",
  });
  assert.equal(a, b);
  assert.match(a, /^space-hook-[0-9a-f]{24}$/);
});

test("isReentrantSpaceHookEvent blocks hook-generated turns", () => {
  assert.equal(
    isReentrantSpaceHookEvent({
      type: "session.turn.finalized",
      payload: {
        turn: {
          meta: { source: "space_hook", context: { kind: "space_hook" } },
        },
      },
    }),
    true,
  );
  assert.equal(
    isReentrantSpaceHookEvent({
      type: "session.turn.finalized",
      payload: {
        turn: {
          meta: { source: "web_app" },
        },
      },
    }),
    false,
  );
});

test("maybeEnqueueSpaceHookTask skips non-hookable and re-entrant events", async () => {
  const calls: unknown[] = [];
  const enqueue = async (name: string, payload: unknown, options: unknown) => {
    calls.push({ name, payload, options });
    return { id: "job-1" };
  };

  assert.equal(
    await maybeEnqueueSpaceHookTask({
      event: { type: "session.created", spaceId: "space-1" },
      enqueue,
    }),
    null,
  );

  assert.equal(
    await maybeEnqueueSpaceHookTask({
      event: {
        type: "session.turn.finalized",
        spaceId: "space-1",
        payload: { turn: { meta: { source: "space_hook" } } },
      },
      enqueue,
    }),
    null,
  );

  const result = await maybeEnqueueSpaceHookTask({
    event: {
      id: "event-1",
      type: "checkpoint.created",
      spaceId: "space-1",
      sessionId: "session-1",
      payload: { actor: { userId: "user-1" } },
    },
    enqueue,
  });

  assert.ok(result);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: "space_hook",
    payload: {
      type: "space_hook",
      spaceId: "space-1",
      sessionId: "session-1",
      data: {
        event: {
          id: "event-1",
          type: "checkpoint.created",
          timestamp: (result as { event: { timestamp: number } }).event.timestamp,
          spaceId: "space-1",
          sessionId: "session-1",
          payload: { actor: { userId: "user-1" } },
        },
        eventActorUserId: "user-1",
      },
    },
    options: {
      jobId: buildSpaceHookTaskId({
        spaceId: "space-1",
        eventId: "event-1",
        eventType: "checkpoint.created",
      }),
    },
  });
});
