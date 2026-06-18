import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, renderStreamingMarkdown } from "../lib/markdown";

test("renderMarkdown keeps nested fences inside markdown code blocks", async () => {
	const html = await renderMarkdown(`\`\`\`markdown
---
description: Print the current time using bash
argument-hint: ""
category: general
---
Please run a bash command to output the current date and time.

Use:

\`\`\`bash
date
\`\`\`

Then return the command output directly.
\`\`\``);

	assert.match(html, /<pre/);
	assert.match(html, /language-markdown|shiki/);
	assert.match(html, /```bash/);
	assert.match(html, /Then return the command output directly\./);
	assert.doesNotMatch(
		html,
		/<p>Then return the command output directly\.<\/p>/,
	);
});

test("renderMarkdown renders mermaid fences as diagram placeholders", async () => {
	const html = await renderMarkdown(`\`\`\`mermaid
graph TD
	A[Start] --> B[Done]
\`\`\``);

	assert.match(html, /markdown-mermaid/);
	assert.match(html, /data-mermaid-source=/);
	assert.match(html, /View Mermaid source/);
	assert.doesNotMatch(html, /<pre class="shiki/);
});

test("renderStreamingMarkdown keeps mermaid fences as plain code", async () => {
	const html = await renderStreamingMarkdown(`\`\`\`mermaid
graph TD
	A --> B
\`\`\``);

	assert.match(html, /data-streaming-code="true"/);
	assert.doesNotMatch(html, /markdown-mermaid/);
});

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
