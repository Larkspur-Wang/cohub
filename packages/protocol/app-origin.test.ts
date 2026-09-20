import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCohubAppOrigin,
  isCohubAppHostname,
  resolveCohubAppOrigin,
} from "./src/app-origin.js";

const APP_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("Cohub App origins", () => {
  it("builds environment-specific standalone origins", () => {
    assert.equal(
      createCohubAppOrigin(APP_ID, "prod"),
      `https://${APP_ID}.apps.cohub.live`,
    );
    assert.equal(
      createCohubAppOrigin(APP_ID, "dev"),
      `https://${APP_ID}.apps-dev.cohub.live`,
    );
  });

  it("resolves only the exact environment and canonical HTTPS origin", () => {
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live`, "prod"),
      APP_ID,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps-dev.cohub.live`, "prod"),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`http://${APP_ID}.apps.cohub.live`, "prod"),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live:8443`, "prod"),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live/`, "prod"),
      null,
    );
  });

  it("rejects malformed, nested, and non-App hostnames", () => {
    assert.equal(isCohubAppHostname(`${APP_ID}.apps.cohub.live`, "prod"), true);
    assert.equal(isCohubAppHostname(`x.${APP_ID}.apps.cohub.live`, "prod"), false);
    assert.equal(isCohubAppHostname(`${APP_ID}.apps.cohub.live.evil.test`, "prod"), false);
    assert.equal(isCohubAppHostname("apps.cohub.live", "prod"), false);
  });
});
