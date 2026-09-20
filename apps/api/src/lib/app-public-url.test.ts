import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAppStandaloneUrl } from "./app-public-url.js";

const APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const TEMPLATE = "{id}.apps.example.com";

const input = (overrides: Partial<Parameters<typeof createAppStandaloneUrl>[0]> = {}) => ({
  appId: APP_ID,
  status: "published",
  visibility: "public",
  targetType: "file",
  contentKind: "web",
  ...overrides,
});

describe("createAppStandaloneUrl", () => {
  it("creates origins only for static web Apps", () => {
    assert.equal(
      createAppStandaloneUrl(input(), TEMPLATE),
      `https://${APP_ID}.apps.example.com`,
    );
    assert.equal(
      createAppStandaloneUrl(input({ targetType: "directory" }), TEMPLATE),
      `https://${APP_ID}.apps.example.com`,
    );
    assert.equal(createAppStandaloneUrl(input({ targetType: "port" }), TEMPLATE), null);
    assert.equal(createAppStandaloneUrl(input({ contentKind: "board" }), TEMPLATE), null);
    assert.equal(createAppStandaloneUrl(input({ status: "disabled" }), TEMPLATE), null);
    assert.equal(createAppStandaloneUrl(input({ visibility: "space" }), TEMPLATE), null);
  });

  it("disables standalone origins without a configured template", () => {
    assert.equal(createAppStandaloneUrl(input(), null), null);
  });
});
