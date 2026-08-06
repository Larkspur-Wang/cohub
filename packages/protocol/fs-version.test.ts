import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSpaceFsVersion } from "./src/fs/index.js";

test("matches file versions at transport millisecond precision", () => {
  const expected = { size: 12, mtimeMs: 1_700_000_000_000.75 };

  assert.equal(matchesSpaceFsVersion(expected, expected), true);
  assert.equal(
    matchesSpaceFsVersion(
      { size: expected.size, mtimeMs: Math.trunc(expected.mtimeMs) },
      expected,
    ),
    true,
  );
  assert.equal(
    matchesSpaceFsVersion({ ...expected, size: expected.size + 1 }, expected),
    false,
  );
  assert.equal(
    matchesSpaceFsVersion(
      { ...expected, mtimeMs: Math.trunc(expected.mtimeMs) + 1 },
      expected,
    ),
    false,
  );
  assert.equal(matchesSpaceFsVersion({ size: expected.size }, expected), false);
});
