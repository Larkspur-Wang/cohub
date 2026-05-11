import assert from "node:assert/strict";
import { test } from "node:test";
import { renderStreamingMarkdown } from "../lib/markdown";

test("renderStreamingMarkdown keeps incomplete emphasis in a plain tail", async () => {
	const html = await renderStreamingMarkdown(
		"A stable paragraph.\n\nThe answer ends with **bol",
	);

	assert.match(html, /A stable paragraph/);
	assert.match(html, /markdown-streaming-tail/);
	assert.match(html, /\*\*bol/);
	assert.doesNotMatch(html, /<strong>bol/);
});

test("renderStreamingMarkdown renders incomplete fenced code as plain code", async () => {
	const html = await renderStreamingMarkdown("```ts\nconst value = 1;");

	assert.match(html, /data-streaming-code="true"/);
	assert.match(html, /const value = 1;/);
	assert.doesNotMatch(html, /shiki/);
});

test("renderStreamingMarkdown does not run shiki while streaming", async () => {
	const html = await renderStreamingMarkdown("```ts\nconst value = 1;\n```");

	assert.match(html, /data-streaming-code="true"/);
	assert.doesNotMatch(html, /shiki/);
});
