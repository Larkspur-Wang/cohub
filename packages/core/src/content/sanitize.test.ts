import assert from "node:assert/strict";
import { sanitizePostgresJsonValue } from "./sanitize.js";

const value = {
  content: [
    { type: "text", text: "fix(agent)\u0000\u0000 harden\u0000" },
    { type: "tool_use", input: { command: "git commit\u0000" } },
  ],
  meta: {
    thinking: "ok\u0000",
    untouched: "normal",
  },
};

assert.deepEqual(sanitizePostgresJsonValue(value), {
  content: [
    { type: "text", text: "fix(agent) harden" },
    { type: "tool_use", input: { command: "git commit" } },
  ],
  meta: {
    thinking: "ok",
    untouched: "normal",
  },
});

assert.equal(sanitizePostgresJsonValue("a\u0000b"), "ab");
console.log("sanitizePostgresJsonValue tests passed");
