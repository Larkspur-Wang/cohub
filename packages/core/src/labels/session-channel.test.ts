import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getSessionChannelLabelSystemKey,
  parseSessionChannelLabelSystemKey,
  SESSION_CHANNEL_LABEL_SYSTEM_KEY_PREFIX,
  SESSION_CHANNEL_ROOT_LABEL_SYSTEM_KEY,
} from "./session-channel.js";

test("session channel system keys are stable", () => {
  const channelId = "11111111-2222-4333-8444-555555555555";
  assert.equal(getSessionChannelLabelSystemKey(channelId), `${SESSION_CHANNEL_LABEL_SYSTEM_KEY_PREFIX}${channelId}`);
  assert.equal(SESSION_CHANNEL_ROOT_LABEL_SYSTEM_KEY, `${SESSION_CHANNEL_LABEL_SYSTEM_KEY_PREFIX}root`);
});

test("parseSessionChannelLabelSystemKey reads channel ids", () => {
  const channelId = "11111111-2222-4333-8444-555555555555";
  assert.equal(parseSessionChannelLabelSystemKey(getSessionChannelLabelSystemKey(channelId)), channelId);
  assert.equal(parseSessionChannelLabelSystemKey(SESSION_CHANNEL_ROOT_LABEL_SYSTEM_KEY), null);
  assert.equal(parseSessionChannelLabelSystemKey("session-user:abc"), null);
  assert.equal(parseSessionChannelLabelSystemKey(null), null);
});
