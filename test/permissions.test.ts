import assert from "node:assert/strict";
import { hasPermission, roleHasPermission, type PermissionStore } from "../packages/core/src/permissions/index.js";

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
  assert.equal(roleHasPermission("guest", "session.view"), true, "guest can view sessions");
  assert.equal(roleHasPermission("guest", "session.prompt.readonly"), false, "guest cannot prompt sessions");
  assert.equal(roleHasPermission("guest", "session.prompt.fullaccess"), false, "guest cannot prompt with full access");

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
