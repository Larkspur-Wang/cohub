import assert from "node:assert/strict";
import {
  compareSpaceRole,
  hasPermission,
  isRoleHigherThan,
  isRoleLowerThan,
  roleHasPermission,
  type PermissionStore,
} from "../packages/core/src/permissions/index.js";

const denyAllStore: PermissionStore = {
  async getSpaceMemberRole() {
    return null;
  },
  async getAccessPolicy() {
    return null;
  },
  async getSessionSpaceId() {
    return null;
  },
};

const signedInGuestPolicyStore: PermissionStore = {
  ...denyAllStore,
  async getAccessPolicy() {
    return { signedInUserRole: "guest", anonymousUserRole: null };
  },
};

async function main() {
  assert.equal(compareSpaceRole("host", "builder") > 0, true, "host ranks above builder");
  assert.equal(compareSpaceRole("builder", "guest") > 0, true, "builder ranks above guest");
  assert.equal(isRoleHigherThan("builder", "guest"), true, "builder is higher than guest");
  assert.equal(isRoleLowerThan("guest", "builder"), true, "guest is lower than builder");
  assert.equal(isRoleHigherThan("guest", "builder"), false, "guest is not higher than builder");

  assert.equal(roleHasPermission("guest", "session.view"), true, "guest can view sessions");
  assert.equal(roleHasPermission("guest", "session.prompt.readonly"), false, "guest cannot prompt sessions");
  assert.equal(roleHasPermission("guest", "session.prompt.fullaccess"), false, "guest cannot prompt with full access");
  assert.equal(roleHasPermission("host", "generation.create"), true, "host can create generation tasks");
  assert.equal(roleHasPermission("builder", "generation.create"), true, "builder can create generation tasks");
  assert.equal(roleHasPermission("guest", "generation.create"), false, "guest cannot create generation tasks");

  assert.equal(
    await hasPermission({
      store: signedInGuestPolicyStore,
      user: { uuid: "viewer" },
      permission: "session.view",
      context: { spaceId: "space1", sessionId: "session1" },
    }),
    true,
    "signed-in guest policy still grants view access",
  );

  assert.equal(
    await hasPermission({
      store: signedInGuestPolicyStore,
      user: { uuid: "viewer" },
      permission: "session.prompt.readonly",
      context: { spaceId: "space1", sessionId: "session1" },
    }),
    false,
    "signed-in guest policy must not allow CLI/API prompt submission",
  );

  console.log("permissions tests passed");
}

void main();
