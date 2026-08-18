import assert from "node:assert/strict";
import { test } from "node:test";
import { isCreateModeCommand } from "../lib/composer-mode-command";

test("isCreateModeCommand recognizes the standalone create command", () => {
	assert.equal(isCreateModeCommand(":create"), true);
	assert.equal(isCreateModeCommand("  :create  "), true);
});

test("isCreateModeCommand ignores create text in message content", () => {
	assert.equal(isCreateModeCommand(":creat"), false);
	assert.equal(isCreateModeCommand(":create-image"), false);
	assert.equal(isCreateModeCommand(":create Draw an illustration"), false);
	assert.equal(isCreateModeCommand("Use :create for this"), false);
});
