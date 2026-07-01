import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, renderStreamingMarkdownSplit } from "../lib/markdown";

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

test("renderMarkdown adds href titles to links without overriding explicit titles", async () => {
	const html = await renderMarkdown(
		`[line](/workspace/apps/web/src/app.ts:12) [docs](docs/readme.md "Docs")`,
	);

	assert.match(
		html,
		/<a href="\/workspace\/apps\/web\/src\/app.ts:12" title="\/workspace\/apps\/web\/src\/app.ts:12">line<\/a>/,
	);
	assert.match(html, /<a href="docs\/readme.md" title="Docs">docs<\/a>/);
});

test("renderMarkdown renders mermaid fences as diagram placeholders", async () => {
	const html = await renderMarkdown(`\`\`\`mermaid
graph TD
	A[Start] --> B[Done]
\`\`\``);

	assert.match(html, /markdown-mermaid/);
	assert.match(html, /data-mermaid-source=/);
	assert.match(html, /<summary>Source<\/summary>/);
	assert.doesNotMatch(html, /<pre class="shiki/);
});

test("renderStreamingMarkdownSplit places closed mermaid fence in stable region", async () => {
	// Closed fences go through renderMarkdownBlock (same as the old
	// renderStreamingMarkdownBlocks production code), which runs
	// enhanceMermaidTokens. The diagram itself is only rendered after
	// streaming ends — MarkdownSurface skips renderMermaid() while live.
	const { stableHtml, tailHtml } = await renderStreamingMarkdownSplit(
		`\`\`\`mermaid\ngraph TD\n\tA --> B\n\`\`\``,
	);

	assert.match(stableHtml, /markdown-mermaid/);
	assert.equal(tailHtml, "");
});

test("renderMarkdown renders cohub ask fences as composer options", async () => {
	const html = await renderMarkdown(`\`\`\`cohub-ask
{
	"version": 1,
	"questions": [
		{
			"question": "How should we proceed?",
			"header": "Next step",
			"multiSelect": false,
			"options": [
				{
					"label": "Quick path",
					"description": "Ship the minimal renderer first.",
					"value": "Use the quick path."
				},
				{
					"label": "Full design",
					"description": "Define protocol and tests upfront.",
					"value": "Use the full design path."
				}
			]
		}
	]
}
\`\`\``);

	assert.match(html, /markdown-cohub-ask/);
	assert.match(html, /data-cohub-ask-option="true"/);
	assert.match(html, /data-cohub-ask-value="Use%20the%20quick%20path\."/);
	assert.doesNotMatch(html, /<pre class="shiki/);
});

test("renderMarkdown keeps invalid cohub ask fences as code", async () => {
	const html = await renderMarkdown(`\`\`\`cohub-ask
{"version":1,"questions":[]}
\`\`\``);

	assert.match(html, /<pre/);
	assert.match(html, /language-cohub-ask/);
	assert.doesNotMatch(html, /markdown-cohub-ask/);
});

test("renderStreamingMarkdownSplit renders unclosed fence as plain code in tail", async () => {
	const { stableHtml, tailHtml } = await renderStreamingMarkdownSplit(
		"```ts\nconst value = 1;",
	);

	// Short source (< 140 chars) → everything in tail, stable empty
	assert.equal(stableHtml, "");
	assert.match(tailHtml, /data-streaming-code="true"/);
	assert.match(tailHtml, /const value = 1;/);
	assert.doesNotMatch(tailHtml, /shiki/);
});

test("renderStreamingMarkdownSplit does not run shiki on closed fence", async () => {
	const { stableHtml, tailHtml } = await renderStreamingMarkdownSplit(
		"```ts\nconst value = 1;\n```",
	);

	// Closed fence → stable region, rendered without shiki during streaming
	assert.match(stableHtml, /<pre/);
	assert.doesNotMatch(stableHtml, /shiki/);
	assert.equal(tailHtml, "");
});

test("renderStreamingMarkdownSplit splits long content into stable and tail", async () => {
	// The tail must be long enough (>= 84 chars) for findStreamingSafeIndex
	// to place the paragraph boundary in the stable region.
	const stablePara =
		"This is a stable paragraph that is long enough to be promoted.".repeat(3);
	const tailPara =
		"The answer ends with **bol and we need enough text here to ensure the tail is long enough for splitting.";
	const source = `${stablePara}\n\n${tailPara}`;

	const { stableHtml, tailHtml } = await renderStreamingMarkdownSplit(source);

	assert.match(stableHtml, /stable paragraph/);
	assert.ok(tailHtml.length > 0, "tail should contain the growing paragraph");
	// remend repairs the unclosed **, so the tail renders as bold
	assert.match(tailHtml, /bol/);
});

test("renderStreamingMarkdownSplit returns empty for empty source", async () => {
	const { stableHtml, tailHtml } = await renderStreamingMarkdownSplit("");

	assert.equal(stableHtml, "");
	assert.equal(tailHtml, "");
});
