import assert from "node:assert/strict";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { mergeStreamingDeltaBlocks } from "../lib/session-render";

const existing: ContentBlock[] = [
	{ type: "text", text: "before", _meta: { streamIndex: 0 } },
	{
		type: "tool_use",
		id: "t1",
		name: "bash",
		input: { command: "pwd" },
		_meta: { streamIndex: 1, toolStatus: "done" },
	},
	{
		type: "tool_result",
		tool_use_id: "t1",
		content: "/workspace",
		_meta: { streamIndex: 1, toolStatus: "done" },
	},
	{ type: "text", text: "af", _meta: { streamIndex: 2 } },
];

const delta: ContentBlock[] = [
	{ type: "text", text: "ter", _meta: { streamIndex: 2 } },
];

const merged = mergeStreamingDeltaBlocks(existing, delta);
const textBlocks = merged.filter(
	(block): block is Extract<ContentBlock, { type: "text" }> =>
		block.type === "text",
);

assert.equal(textBlocks[0]?.text, "before");
assert.equal(textBlocks[1]?.text, "after");

const delta2: ContentBlock[] = [
	{ type: "text", text: "!", _meta: { streamIndex: 0 } },
];
const merged2 = mergeStreamingDeltaBlocks(merged, delta2);
const textBlocks2 = merged2.filter(
	(block): block is Extract<ContentBlock, { type: "text" }> =>
		block.type === "text",
);
assert.equal(textBlocks2[0]?.text, "before!");
assert.equal(textBlocks2[1]?.text, "after");

console.log("session-render merge checks passed");
