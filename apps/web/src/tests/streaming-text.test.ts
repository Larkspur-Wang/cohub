import assert from "node:assert/strict";
import { test } from "node:test";
import { splitStreamingText } from "../lib/streaming-text.ts";

test("splitStreamingText keeps existing text stable and isolates appended tail", () => {
	assert.deepEqual(splitStreamingText("hello", "hello world", true), {
		stableText: "hello",
		tailText: " world",
	});
});

test("splitStreamingText treats first streaming chunk as animated tail", () => {
	assert.deepEqual(splitStreamingText("", "thinking...", true), {
		stableText: "",
		tailText: "thinking...",
	});
});

test("splitStreamingText resets cleanly when content changes non-monotonically", () => {
	assert.deepEqual(splitStreamingText("hello world", "restarted", true), {
		stableText: "",
		tailText: "restarted",
	});
});

test("splitStreamingText renders full text as stable when not active", () => {
	assert.deepEqual(splitStreamingText("hello", "hello world", false), {
		stableText: "hello world",
		tailText: "",
	});
});
