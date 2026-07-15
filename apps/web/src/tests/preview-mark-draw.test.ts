import assert from "node:assert/strict";
import { test } from "node:test";
import { MARK_COLOR_HEX } from "../lib/features/preview-mark/types";

test("mark colors are defined for all tokens", () => {
	assert.equal(typeof MARK_COLOR_HEX.brand, "string");
	assert.equal(typeof MARK_COLOR_HEX.red, "string");
	assert.equal(typeof MARK_COLOR_HEX.yellow, "string");
	assert.equal(typeof MARK_COLOR_HEX.white, "string");
	for (const value of Object.values(MARK_COLOR_HEX)) {
		assert.match(value, /^#[0-9A-Fa-f]{6}$/);
	}
});
