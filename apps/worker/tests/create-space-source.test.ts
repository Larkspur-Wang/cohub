import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCreateSpaceSource } from "../src/tasks/create-space-source.js";

test("create Space jobs preserve normalized checkpoint and git sources", () => {
  assert.deepEqual(
    resolveCreateSpaceSource({
      data: {
        source: { type: "checkpoint", checkpointId: "  checkpoint-1  " },
      },
    }),
    { source: { type: "checkpoint", checkpointId: "checkpoint-1" } },
  );
  assert.deepEqual(
    resolveCreateSpaceSource({
      data: {
        source: {
          type: "git_repo",
          repoUrl: "  https://example.test/repo.git  ",
          ref: "  main  ",
        },
        gitToken: "  secret  ",
      },
    }),
    {
      source: {
        type: "git_repo",
        repoUrl: "https://example.test/repo.git",
        ref: "main",
      },
      gitToken: "secret",
    },
  );
});

test("create Space jobs reject malformed sources instead of falling back to blank", () => {
  assert.deepEqual(resolveCreateSpaceSource({}), { source: { type: "blank" } });
  assert.throws(
    () =>
      resolveCreateSpaceSource({
        data: { source: { type: "checkpoint", checkpointId: "" } },
      }),
    /checkpoint id is required/,
  );
  assert.throws(
    () =>
      resolveCreateSpaceSource({
        data: { source: { type: "checkpont", checkpointId: "checkpoint-1" } },
      }),
    /invalid create space source/,
  );
});
