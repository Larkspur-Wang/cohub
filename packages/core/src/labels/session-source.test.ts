import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSessionSourceLabelSystemKey,
  resolveKnownSessionSourceLabelSystemKey,
  resolveSessionSourceLabelRef,
} from "./session-source.js";

test("resolveSessionSourceLabelRef maps known channel providers", () => {
  assert.equal(resolveSessionSourceLabelRef({ provider: "qq" }), "Source/QQ");
  assert.equal(resolveSessionSourceLabelRef({ provider: "telegram" }), "Source/Telegram");
  assert.equal(resolveSessionSourceLabelRef({ provider: "wechat" }), "Source/WeChat");
  assert.equal(resolveSessionSourceLabelRef({ provider: "discord" }), "Source/Discord");
  assert.equal(resolveSessionSourceLabelRef({ provider: "feishu" }), "Source/Feishu");
  assert.equal(resolveSessionSourceLabelRef({ provider: "slack" }), "Source/Slack");
});

test("resolveSessionSourceLabelRef maps channel-prefixed source strings", () => {
  assert.equal(resolveSessionSourceLabelRef({ source: "qq:c2c:12345" }), "Source/QQ");
  assert.equal(resolveSessionSourceLabelRef({ source: "channel:qq" }), "Source/QQ");
  assert.equal(resolveSessionSourceLabelRef({ source: "telegram:chat-1" }), "Source/Telegram");
  assert.equal(resolveSessionSourceLabelRef({ source: "wechat:user-1" }), "Source/WeChat");
});

test("resolveSessionSourceLabelRef prefers provider over source", () => {
  assert.equal(
    resolveSessionSourceLabelRef({ provider: "qq", source: "discord:ignored" }),
    "Source/QQ",
  );
});

test("resolveSessionSourceLabelRef falls back to Other for unknown sources", () => {
  assert.equal(resolveSessionSourceLabelRef({ source: null }), "Source/Other");
  assert.equal(resolveSessionSourceLabelRef({ source: "mystery" }), "Source/Other");
  assert.equal(resolveSessionSourceLabelRef({ provider: "unknown" }), "Source/Other");
});

test("resolveKnownSessionSourceLabelSystemKey covers QQ", () => {
  assert.equal(
    resolveKnownSessionSourceLabelSystemKey("Source/QQ"),
    getSessionSourceLabelSystemKey("qq"),
  );
  assert.equal(
    resolveKnownSessionSourceLabelSystemKey("Source/Telegram"),
    getSessionSourceLabelSystemKey("telegram"),
  );
  assert.equal(resolveKnownSessionSourceLabelSystemKey("Source/Other"), null);
});
