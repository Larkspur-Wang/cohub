import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppStandaloneUrl } from "./app-public-url.js";

const APP_ID = "550e8400-e29b-41d4-a716-446655440000";

const createUrl = (targetType: string, contentKind = "web") =>
  createAppStandaloneUrl({
    appId: APP_ID,
    status: "published",
    visibility: "public",
    targetType,
    contentKind,
  });

describe("createAppStandaloneUrl", () => {
  it("creates URLs only for static web Apps", () => {
    assert.match(createUrl("file") ?? "", /\.apps(?:-dev)?\.cohub\.live$/);
    assert.match(createUrl("directory") ?? "", /\.apps(?:-dev)?\.cohub\.live$/);
    assert.equal(createUrl("port"), null);
    assert.equal(createUrl("file", "board"), null);
  });
});
