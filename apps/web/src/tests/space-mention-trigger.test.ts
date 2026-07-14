import assert from "node:assert/strict";
import test from "node:test";
import {
	detectSpaceMentionTriggerFromText,
	spaceMentionTriggerKey,
} from "../lib/mentions/space-trigger";

test("detects bare @ at start", () => {
	const trigger = detectSpaceMentionTriggerFromText("@", {
		start: 1,
		end: 1,
	});
	assert.deepEqual(trigger, { start: 0, end: 1, query: "" });
});

test("detects query after @", () => {
	const trigger = detectSpaceMentionTriggerFromText("hello @core", {
		start: 11,
		end: 11,
	});
	assert.deepEqual(trigger, { start: 6, end: 11, query: "core" });
});

test("ignores email-like mid-token @", () => {
	const trigger = detectSpaceMentionTriggerFromText("hello@core", {
		start: 10,
		end: 10,
	});
	assert.equal(trigger, null);
});

test("ignores non-collapsed selection", () => {
	const trigger = detectSpaceMentionTriggerFromText("@core", {
		start: 1,
		end: 3,
	});
	assert.equal(trigger, null);
});

test("ignores caret before @", () => {
	const trigger = detectSpaceMentionTriggerFromText("@core", {
		start: 0,
		end: 0,
	});
	assert.equal(trigger, null);
});

test("spaceMentionTriggerKey tracks @ occurrence by start index", () => {
	assert.equal(spaceMentionTriggerKey({ start: 3, end: 8, query: "api" }), "3");
	assert.equal(
		spaceMentionTriggerKey({ start: 3, end: 9, query: "apis" }),
		"3",
	);
});
