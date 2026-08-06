import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLocalSpaceName } from "../src/commands/sandbox.js";

test("local sandbox space names prefer explicit input and fall back to the directory", () => {
  assert.equal(resolveLocalSpaceName("/workspace/project", "  Local dev  "), "Local dev");
  assert.equal(resolveLocalSpaceName("/workspace/project"), "project");
  assert.equal(resolveLocalSpaceName("/"), "local-space");
});
