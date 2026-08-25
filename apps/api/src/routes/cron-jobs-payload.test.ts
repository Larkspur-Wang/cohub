import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { preserveCronPayloadAuth } from "./cron-jobs-payload.js";

const serverAuth = {
  type: "delegated_prompt",
  source: "app_session",
  actorUserId: "user-1",
  appId: "app-1",
  spaceId: "space-1",
  scopes: ["session.prompt.fullaccess"],
  appScopes: [],
  viewerScopes: ["session.prompt.fullaccess"],
  delegatedAt: "2026-01-01T00:00:00.000Z",
  exp: 1900000000,
  appViewerGrantId: "grant-1",
};

describe("preserveCronPayloadAuth", () => {
  it("drops a client-injected auth when the original payload has none", () => {
    const forged = preserveCronPayloadAuth(
      { content: [{ type: "text", text: "hi" }], auth: { ...serverAuth, appId: "victim-app" } },
      { content: [{ type: "text", text: "old" }] },
    );
    assert.equal("auth" in forged, false);
    assert.deepEqual(forged.content, [{ type: "text", text: "hi" }]);
  });

  it("keeps the original server auth verbatim when a client tries to replace it", () => {
    const replaced = preserveCronPayloadAuth(
      { content: [], auth: { ...serverAuth, appId: "attacker-app", scopes: ["member.manage"] } },
      { content: [], auth: serverAuth },
    );
    assert.deepEqual(replaced.auth, serverAuth);
  });

  it("keeps the original auth when a client tries to delete it", () => {
    const deleted = preserveCronPayloadAuth(
      { content: [] },
      { content: [], auth: serverAuth },
    );
    assert.deepEqual(deleted.auth, serverAuth);
  });

  it("drops a client-sent auth: null instead of preserving it", () => {
    // The original has no auth; the client cannot introduce one, not even null.
    const nulled = preserveCronPayloadAuth({ content: [], auth: null }, { content: [] });
    assert.equal("auth" in nulled, false);
  });

  it("leaves a payload without auth untouched in both directions", () => {
    const merged = preserveCronPayloadAuth({ content: [], title: "x" }, { content: [] });
    assert.equal("auth" in merged, false);
    assert.equal(merged.title, "x");
  });
});
