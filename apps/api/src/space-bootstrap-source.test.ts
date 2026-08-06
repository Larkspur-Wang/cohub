import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSpaceBootstrapSource,
  sanitizeSpaceBootstrapSource,
} from "./space-bootstrap-source.js";

const isValidCheckpointId = (value: string) => value.startsWith("checkpoint-");

test("space bootstrap source normalizes blank, git, and checkpoint inputs", () => {
  assert.deepEqual(normalizeSpaceBootstrapSource(undefined, isValidCheckpointId), {
    type: "blank",
  });
  assert.deepEqual(
    normalizeSpaceBootstrapSource(
      {
        type: "git_repo",
        repoUrl: "  https://example.test/repo.git  ",
        ref: "  main  ",
      },
      isValidCheckpointId,
    ),
    {
      type: "git_repo",
      repoUrl: "https://example.test/repo.git",
      ref: "main",
    },
  );
  assert.deepEqual(
    normalizeSpaceBootstrapSource(
      { type: "checkpoint", checkpointId: "  checkpoint-1  " },
      isValidCheckpointId,
    ),
    { type: "checkpoint", checkpointId: "checkpoint-1" },
  );
});

test("space bootstrap source removes persisted Git credentials from API output", () => {
  assert.deepEqual(
    sanitizeSpaceBootstrapSource({
      type: "git_repo",
      repoUrl: "https://user:password@example.test/repo.git",
      ref: "main",
      gitToken: "secret",
    }),
    {
      type: "git_repo",
      repoUrl: "https://example.test/repo.git",
      ref: "main",
    },
  );
});

test("space bootstrap source rejects malformed inputs instead of creating a blank Space", () => {
  assert.throws(
    () => normalizeSpaceBootstrapSource({ type: "checkpont" }, isValidCheckpointId),
    /invalid bootstrap source/,
  );
  assert.throws(
    () =>
      normalizeSpaceBootstrapSource(
        { type: "checkpoint", checkpointId: "invalid" },
        isValidCheckpointId,
      ),
    /checkpointId is required/,
  );
  assert.throws(
    () =>
      normalizeSpaceBootstrapSource(
        { type: "git_repo", repoUrl: "https://example.test/repo.git", ref: 42 },
        isValidCheckpointId,
      ),
    /ref must be a string/,
  );
});
