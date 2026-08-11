import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHostAllowedBySuffix } from "./config.js";

const DEFAULT_SUFFIXES = [".cohub.run", ".cohub.live"];

describe("isHostAllowedBySuffix", () => {
  it("matches the bare domain", () => {
    assert.equal(isHostAllowedBySuffix("cohub.run", DEFAULT_SUFFIXES), true);
    assert.equal(isHostAllowedBySuffix("cohub.live", DEFAULT_SUFFIXES), true);
  });

  it("matches subdomains", () => {
    assert.equal(isHostAllowedBySuffix("works.cohub.run", DEFAULT_SUFFIXES), true);
    assert.equal(isHostAllowedBySuffix("s-abc-3000.cohub.live", DEFAULT_SUFFIXES), true);
    assert.equal(isHostAllowedBySuffix("anything.cohub.run", DEFAULT_SUFFIXES), true);
  });

  it("rejects unrelated hosts and suffix lookalikes", () => {
    assert.equal(isHostAllowedBySuffix("notcohub.run", DEFAULT_SUFFIXES), false);
    assert.equal(isHostAllowedBySuffix("cohub.run.evil.example", DEFAULT_SUFFIXES), false);
    assert.equal(isHostAllowedBySuffix("evilcohub.run", DEFAULT_SUFFIXES), false);
    assert.equal(isHostAllowedBySuffix("example.com", DEFAULT_SUFFIXES), false);
  });

  it("is case-insensitive", () => {
    assert.equal(isHostAllowedBySuffix("COHUB.RUN", DEFAULT_SUFFIXES), true);
    assert.equal(isHostAllowedBySuffix("Works.Cohub.Live", DEFAULT_SUFFIXES), true);
  });

  it("accepts suffixes with or without a leading dot", () => {
    assert.equal(isHostAllowedBySuffix("cohub.live", ["cohub.live"]), true);
    assert.equal(isHostAllowedBySuffix("s-1-3000.cohub.live", ["cohub.live"]), true);
    assert.equal(isHostAllowedBySuffix("cohub.live", [".cohub.live"]), true);
    assert.equal(isHostAllowedBySuffix("s-1-3000.cohub.live", [".cohub.live"]), true);
  });
});
