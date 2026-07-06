import assert from "node:assert/strict";
import { test } from "node:test";
import {
	describeTextValue,
	formatToolInputView,
	isLongTextValue,
} from "../lib/components/tool-call-format.ts";

test("formats bash input without JSON noise", () => {
	const view = formatToolInputView("bash", {
		command: "pnpm lint",
		timeout: 30,
	});
	assert.ok(view);
	assert.equal(view?.primary?.value, "pnpm lint");
	assert.deepEqual(view?.fields, [{ label: "timeout", value: "30s" }]);
});

test("formats read input as path plus range", () => {
	const view = formatToolInputView("read", {
		path: "/workspace/apps/web/src/lib/components/ToolCallItem.svelte",
		offset: 1,
		limit: 200,
	});
	assert.ok(view);
	assert.equal(
		view?.primary?.value,
		"apps/web/src/lib/components/ToolCallItem.svelte",
	);
	assert.deepEqual(view?.fields, [{ label: "lines", value: "1–200" }]);
});

test("formats write input with collapsible content section", () => {
	const content = Array.from(
		{ length: 12 },
		(_, index) => `line ${index + 1}`,
	).join("\n");
	const view = formatToolInputView("write", {
		path: "/workspace/apps/web/src/lib/foo.ts",
		content,
	});
	assert.ok(view);
	assert.equal(view?.primary?.value, "apps/web/src/lib/foo.ts");
	assert.deepEqual(view?.fields, []);
	assert.equal(view?.sections[0]?.id, "content");
	assert.match(view?.sections[0]?.summary ?? "", /12 lines/);
	assert.equal(view?.sections[0]?.collapsible, true);
});

test("describes and classifies long text values", () => {
	const short = "one line";
	const long = Array.from(
		{ length: 11 },
		(_, index) => `line ${index + 1}`,
	).join("\n");

	assert.equal(describeTextValue(short), "1 line · 8 B");
	assert.match(describeTextValue(long), /11 lines/);
	assert.equal(isLongTextValue(short), false);
	assert.equal(isLongTextValue(long), true);
});

test("formats edit input as replacement diff sections", () => {
	const view = formatToolInputView("edit", {
		path: "/workspace/apps/web/src/lib/foo.ts",
		edits: [{ oldText: "old\nblock", newText: "new\nblock" }],
	});
	assert.ok(view);
	assert.equal(view?.primary?.value, "apps/web/src/lib/foo.ts");
	assert.deepEqual(view?.fields, [{ label: "edits", value: "1 replacement" }]);
	assert.equal(view?.sections[0]?.kind, "diff");
	assert.equal(view?.sections[0]?.lines?.[0]?.sign, "-");
	assert.equal(view?.sections[0]?.lines?.[2]?.sign, "+");
});
