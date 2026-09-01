import assert from "node:assert/strict";
import { test } from "node:test";
import { MarketplaceCatalogSchema, ManifestSchema, isPermissionError, parseCatalog, toInstalledApp } from "./catalog";

const id = "123e4567-e89b-42d3-a456-426614174000";
const entry = { id, ref: "tzwm/cohub/task-browser", name: "Task Browser", url: "https://cdn.example.com/task-browser/index.html" };

test("catalog validation rejects malformed app metadata", () => {
  assert.throws(() => parseCatalog({ format: "cohub.app-marketplace", version: 1, apps: [{ ...entry, id: "not-an-id" }] }));
  assert.throws(() => parseCatalog({ format: "cohub.app-marketplace", version: 1, apps: [{ ...entry, url: "javascript:alert(1)" }] }));
  assert.throws(() => parseCatalog({ format: "cohub.app-marketplace", version: 1, apps: [{ ...entry, ref: "not a ref" }] }));
});

test("marketplace entries convert into a manifest-compatible installed app", () => {
  const app = toInstalledApp(MarketplaceCatalogSchema.parse({ format: "cohub.app-marketplace", version: 1, apps: [entry] }).apps[0]);
  assert.equal(ManifestSchema.parse({ format: "cohub.space-apps", version: 1, apps: [app] }).apps[0]?.source.type, "marketplace");
});

test("permission errors are separated from data errors", () => {
  assert.equal(isPermissionError({ status: 403 }), true);
  assert.equal(isPermissionError(new Error("catalog unavailable")), false);
});
