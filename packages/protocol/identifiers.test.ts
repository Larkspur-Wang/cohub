import assert from "node:assert/strict";
import test from "node:test";
import { isUuid, isUuidOrShortUuid } from "./src/identifiers.js";

test("UUID validation accepts RFC 9562 versions including v8", () => {
  assert.equal(isUuid("792fbfaa-47ad-8590-8236-8ff6bed2945f"), true);
  assert.equal(isUuid("792fbfaa-47ad-4590-8236-8ff6bed2945f"), true);
  assert.equal(isUuid("792fbfaa-47ad-9590-8236-8ff6bed2945f"), false);
  assert.equal(isUuid("792fbfaa-47ad-8590-7236-8ff6bed2945f"), false);
});

test("short UUID compatibility remains separate", () => {
  const shortUuid = "792fbfaa47ad859082368ff6bed2945f";
  assert.equal(isUuid(shortUuid), false);
  assert.equal(isUuidOrShortUuid(shortUuid), true);
});
