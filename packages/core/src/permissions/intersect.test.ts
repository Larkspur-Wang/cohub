import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Permission } from "./index.js";
import { intersectPermissionScopes } from "./index.js";

const perms = (scopes: string[]) => scopes as Permission[];

describe("intersectPermissionScopes", () => {
  it("keeps only scopes the viewer still holds", () => {
    const grantScopes = perms(["session.prompt.fullaccess", "member.manage", "space.edit", "file.view"]);
    // A host downgraded to builder keeps prompt and file access, loses member/space management.
    const builderPermissions = perms(["session.prompt.fullaccess", "file.view", "session.view"]);
    assert.deepEqual(intersectPermissionScopes(grantScopes, builderPermissions), [
      "session.prompt.fullaccess",
      "file.view",
    ]);
  });

  it("honours implications: full access keeps read-only alive", () => {
    assert.deepEqual(
      intersectPermissionScopes(perms(["session.prompt.readonly"]), perms(["session.prompt.fullaccess"])),
      ["session.prompt.readonly"],
    );
    assert.deepEqual(
      intersectPermissionScopes(perms(["file.view.filtered"]), perms(["file.view"])),
      ["file.view.filtered"],
    );
  });

  it("returns nothing when the viewer lost every granted scope", () => {
    assert.deepEqual(intersectPermissionScopes(perms(["member.manage", "space.edit"]), perms(["space.view"])), []);
  });

  it("deduplicates and preserves order", () => {
    assert.deepEqual(
      intersectPermissionScopes(perms(["file.view", "file.view", "session.view"]), perms(["session.view", "file.view"])),
      ["file.view", "session.view"],
    );
  });
});
