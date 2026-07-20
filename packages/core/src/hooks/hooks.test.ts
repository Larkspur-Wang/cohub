import assert from "node:assert/strict";
import test from "node:test";
import { isReentrantSpaceHookEvent, parseSpaceHookDefinition, spaceHookMatchesEvent } from "./index.js";

test("parseSpaceHookDefinition accepts inline run hooks", () => {
  const hook = parseSpaceHookDefinition(
    `
schema: cohub.space-hook.v1
on:
  event: space.fs.changed
  paths:
    - src/**
run: |
  npm test
`,
    ".cohub/hooks/on-fs-changed.yml",
  );
  assert.equal(hook.event, "space.fs.changed");
  assert.deepEqual(hook.paths, ["src/**"]);
  assert.equal(hook.action, "run");
  assert.equal(hook.run?.includes("npm test"), true);
});

test("parseSpaceHookDefinition accepts prompt hooks", () => {
  const hook = parseSpaceHookDefinition(
    `
schema: cohub.space-hook.v1
on:
  event: checkpoint.created
prompt:
  text: summarize the new checkpoint
  intent: followup
`,
    ".cohub/hooks/on-checkpoint.yml",
  );
  assert.equal(hook.action, "prompt");
  assert.equal(hook.prompt?.text, "summarize the new checkpoint");
  assert.equal(hook.prompt?.intent, "followup");
});

test("parseSpaceHookDefinition rejects run and prompt together", () => {
  assert.throws(() => parseSpaceHookDefinition(
    `
schema: cohub.space-hook.v1
on:
  event: space.fs.changed
run: echo hi
prompt: hello
`,
    ".cohub/hooks/bad.yml",
  ));
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

test("spaceHookMatchesEvent filters fs paths", () => {
  const hook = parseSpaceHookDefinition(
    `
schema: cohub.space-hook.v1
on:
  event: space.fs.changed
  paths:
    - src/**
  ignore:
    - src/generated/**
run: echo ok
`,
    ".cohub/hooks/check.yml",
  );

  assert.equal(
    spaceHookMatchesEvent(hook, {
      id: "1",
      type: "space.fs.changed",
      timestamp: Date.now(),
      spaceId: "space",
      payload: {
        changes: [{ path: "src/index.ts", kind: "modify" }],
      },
    }).matched,
    true,
  );

  assert.equal(
    spaceHookMatchesEvent(hook, {
      id: "2",
      type: "space.fs.changed",
      timestamp: Date.now(),
      spaceId: "space",
      payload: {
        changes: [{ path: "src/generated/a.ts", kind: "modify" }],
      },
    }).matched,
    false,
  );
});
