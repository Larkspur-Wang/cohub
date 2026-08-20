import assert from "node:assert/strict";
import test from "node:test";
import { classifyChannelError } from "./channel-health.js";

test("classifies QQ close code 4014 as a permission error", () => {
  assert.deepEqual(classifyChannelError("WebSocket closed: code=4014"), {
    reasonCode: "permission",
    message: "Missing permissions",
    detail: "WebSocket closed: code=4014",
  });
});
