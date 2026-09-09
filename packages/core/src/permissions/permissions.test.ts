import assert from "node:assert/strict";
import { it } from "node:test";
import { ROLE_PERMISSIONS, isUserLevelPermission } from "./index.js";

it("space.create is account-level, never a role permission", () => {
  assert.ok(isUserLevelPermission("space.create"));
  for (const role of Object.keys(ROLE_PERMISSIONS) as Array<keyof typeof ROLE_PERMISSIONS>) {
    assert.ok(!ROLE_PERMISSIONS[role].has("space.create"));
  }
});
