import assert from "node:assert/strict";
import test from "node:test";
import { getComposerKeyAction } from "$lib/composer-keyboard";

function key(overrides: Partial<KeyboardEvent> = {}) {
	return {
		key: "Enter",
		altKey: false,
		ctrlKey: false,
		isComposing: false,
		keyCode: 13,
		metaKey: false,
		shiftKey: false,
		...overrides,
	} as KeyboardEvent;
}

test("composer Enter submits on desktop and inserts a newline on mobile", () => {
	assert.equal(getComposerKeyAction(key(), { mobile: false }), "submit");
	assert.equal(getComposerKeyAction(key(), { mobile: true }), "newline");
});

test("composer Shift+Enter inserts a newline", () => {
	assert.equal(
		getComposerKeyAction(key({ shiftKey: true }), { mobile: false }),
		"newline",
	);
});

test("composer modified Enter submits on every device", () => {
	assert.equal(
		getComposerKeyAction(key({ metaKey: true }), { mobile: true }),
		"submit",
	);
	assert.equal(
		getComposerKeyAction(key({ ctrlKey: true }), { mobile: true }),
		"submit",
	);
});

test("composer ignores IME composition and unrelated keys", () => {
	assert.equal(
		getComposerKeyAction(key({ isComposing: true }), { mobile: false }),
		"none",
	);
	assert.equal(
		getComposerKeyAction(key({ key: "Process" }), { mobile: false }),
		"none",
	);
	assert.equal(
		getComposerKeyAction(key({ key: "Escape" }), { mobile: false }),
		"none",
	);
});
