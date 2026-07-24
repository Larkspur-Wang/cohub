import assert from "node:assert/strict";
import { test } from "node:test";
import { activePreviewFilePath } from "../lib/features/space/modules/preview-tabs.ts";

test("file-tree selection follows the active preview kind", () => {
	const filePath = "docs/readme.md";
	const retainedBoardPath = "boards/plan.board";

	assert.equal(
		activePreviewFilePath("file", filePath, retainedBoardPath),
		filePath,
	);
	assert.equal(
		activePreviewFilePath("board", filePath, retainedBoardPath),
		retainedBoardPath,
	);
	assert.equal(activePreviewFilePath("port", filePath, retainedBoardPath), "");
	assert.equal(activePreviewFilePath(null, filePath, retainedBoardPath), "");
});
