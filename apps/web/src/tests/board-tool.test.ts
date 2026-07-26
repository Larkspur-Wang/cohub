import assert from "node:assert/strict";
import { test } from "node:test";
import { type BoardToolId, isContinuousBoardTool } from "$lib/board/board-tool";

test("only Draw stays active after creating an item", () => {
	const tools: BoardToolId[] = [
		"select",
		"hand",
		"text",
		"geo",
		"draw",
		"arrow",
		"frame",
	];

	for (const tool of tools) {
		assert.equal(isContinuousBoardTool(tool), tool === "draw", tool);
	}
});
