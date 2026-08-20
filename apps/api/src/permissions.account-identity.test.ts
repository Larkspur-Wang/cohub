import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asAccountIdentity,
  canAccessOwnTaskRuns,
  canAccessUnscopedTaskRun,
} from "./permissions.js";

describe("asAccountIdentity", () => {
  it("keeps only the account uuid so work/preview scopes cannot leak into account lists", () => {
    const workish = {
      uuid: "user-1",
      workSession: {
        type: "work_session",
        spaceId: "home-space",
        workScopes: ["session.view"],
      },
    };
    assert.deepEqual(asAccountIdentity(workish), { uuid: "user-1" });
    assert.equal(
      Object.keys(asAccountIdentity(workish) as object).join(","),
      "uuid",
    );
  });

  it("requires viewer consent when a Work accesses the viewer's own Task Runs", async () => {
    assert.equal(await canAccessOwnTaskRuns({ uuid: "user-1" } as never), true);
    assert.equal(
      await canAccessOwnTaskRuns({
        uuid: "user-1",
        workSession: {
          userUuid: "user-1",
          workScopes: ["taskrun.view"],
          viewerScopes: [],
          workViewerGrantId: null,
        },
      } as never),
      false,
    );
    assert.equal(
      await canAccessOwnTaskRuns({
        uuid: "user-1",
        workSession: {
          userUuid: "user-1",
          workScopes: [],
          viewerScopes: ["taskrun.view"],
          workViewerGrantId: "grant-1",
          activeViewerGrantScopes: Promise.resolve(["taskrun.view"]),
        },
      } as never),
      true,
    );
  });

  it("applies the same consent gate to unscoped Task details", async () => {
    const workUser = {
      uuid: "user-1",
      workSession: {
        userUuid: "user-1",
        workScopes: ["taskrun.view"],
        viewerScopes: [],
        workViewerGrantId: null,
      },
    } as never;
    assert.equal(await canAccessUnscopedTaskRun(workUser, "user-1"), false);
    assert.equal(await canAccessUnscopedTaskRun({ uuid: "user-1" } as never, "user-1"), true);
    assert.equal(await canAccessUnscopedTaskRun({ uuid: "user-2" } as never, "user-1"), false);
  });

  it("returns null without a usable uuid", () => {
    assert.equal(asAccountIdentity(null), null);
    assert.equal(asAccountIdentity(undefined), null);
    assert.equal(asAccountIdentity({}), null);
    assert.equal(asAccountIdentity({ uuid: "   " }), null);
  });
});
