import assert from "node:assert/strict";
import { test } from "node:test";
import { activePreviewFilePath } from "../lib/features/space/modules/preview-tabs.ts";

test("file-tree selection follows the active preview kind", () => {
	const filePath = "docs/readme.md";
	const retainedCanvasPath = "boards/plan.covas";

	assert.equal(
		activePreviewFilePath("file", filePath, retainedCanvasPath),
		filePath,
	);
	assert.equal(
		activePreviewFilePath("canvas", filePath, retainedCanvasPath),
		retainedCanvasPath,
	);
	assert.equal(activePreviewFilePath("port", filePath, retainedCanvasPath), "");
	assert.equal(activePreviewFilePath(null, filePath, retainedCanvasPath), "");
});
