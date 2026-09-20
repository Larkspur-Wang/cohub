import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCohubAppHostname,
  createCohubAppOrigin,
  isCohubAppHostname,
  parseCohubAppHostTemplate,
  resolveCohubAppOrigin,
} from "./src/app-origin.js";

const APP_ID = "550e8400-e29b-41d4-a716-446655440000";
const PROD = "{id}.apps.cohub.live";
const DEV = "{id}-dev.netaverses.cc";

describe("parseCohubAppHostTemplate", () => {
  it("accepts a single-token hostname and normalizes case", () => {
    assert.equal(parseCohubAppHostTemplate(PROD), PROD);
    assert.equal(parseCohubAppHostTemplate("  {ID}.Apps.Cohub.Live  "), PROD);
    assert.equal(parseCohubAppHostTemplate(DEV), DEV);
  });

  it("treats absent configuration as disabled", () => {
    assert.equal(parseCohubAppHostTemplate(undefined), null);
    assert.equal(parseCohubAppHostTemplate(null), null);
    assert.equal(parseCohubAppHostTemplate("   "), null);
  });

  it("rejects templates that cannot form an App hostname", () => {
    for (const invalid of [
      "{id}",
      "apps.example.com",
      "{id}.{id}.apps.example.com",
      "{id}.apps.example.com/",
      "https://{id}.apps.example.com",
      "{app}.apps.example.com",
      "{id}..apps.example.com",
      "{id}.-apps.example.com",
    ])
      assert.equal(parseCohubAppHostTemplate(invalid), null, invalid);
  });
});

describe("Cohub App origins", () => {
  it("formats standalone origins from a template", () => {
    assert.equal(
      createCohubAppOrigin(APP_ID, PROD),
      `https://${APP_ID}.apps.cohub.live`,
    );
    assert.equal(
      createCohubAppHostname(APP_ID, DEV),
      `${APP_ID}-dev.netaverses.cc`,
    );
  });

  it("resolves the App id from a managed hostname", () => {
    assert.equal(isCohubAppHostname(`${APP_ID}.apps.cohub.live`, PROD), true);
    assert.equal(isCohubAppHostname(`${APP_ID}-dev.netaverses.cc`, DEV), true);
    assert.equal(isCohubAppHostname(`${APP_ID}.apps.cohub.live`, DEV), false);
    assert.equal(isCohubAppHostname(`x.${APP_ID}.apps.cohub.live`, PROD), false);
    assert.equal(
      isCohubAppHostname(`${APP_ID}.apps.cohub.live.evil.test`, PROD),
      false,
    );
    assert.equal(isCohubAppHostname("apps.cohub.live", PROD), false);
  });

  it("resolves only canonical HTTPS origins", () => {
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live`, PROD),
      APP_ID,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}-dev.netaverses.cc`, DEV),
      APP_ID,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}-dev.netaverses.cc`, PROD),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`http://${APP_ID}.apps.cohub.live`, PROD),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live:8443`, PROD),
      null,
    );
    assert.equal(
      resolveCohubAppOrigin(`https://${APP_ID}.apps.cohub.live/`, PROD),
      null,
    );
    assert.equal(resolveCohubAppOrigin(null, PROD), null);
  });
});
