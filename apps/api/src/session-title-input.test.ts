import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionTitleInput } from "./session-title-input.js";

test("parses and trims a session title", () => {
  assert.deepEqual(parseSessionTitleInput({ title: "  Project planning  " }), {
    success: true,
    title: "Project planning",
  });
});

test("accepts an explicit null title", () => {
  assert.deepEqual(parseSessionTitleInput({ title: null }), { success: true, title: null });
});

test("rejects missing or non-string titles", () => {
  assert.deepEqual(parseSessionTitleInput({}), { success: false });
  assert.deepEqual(parseSessionTitleInput({ title: 123 }), { success: false });
  assert.deepEqual(parseSessionTitleInput(null), { success: false });
});
