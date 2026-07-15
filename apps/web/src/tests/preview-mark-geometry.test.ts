import assert from "node:assert/strict";
import { test } from "node:test";
import {
	clampPixelRect,
	cssRectToPixelRect,
	normalizeCropRect,
} from "../lib/features/preview-mark/capture/geometry";
import { suggestedMarkedName } from "../lib/features/preview-mark/types";

test("cssRectToPixelRect maps CSS rect into bitmap space with dpr", () => {
	const rect = cssRectToPixelRect(
		{ left: 100, top: 50, width: 200, height: 100 },
		{ dpr: 2, frameWidth: 1200, frameHeight: 800 },
	);
	assert.deepEqual(rect, { x: 200, y: 100, width: 400, height: 200 });
});

test("cssRectToPixelRect clamps to frame bounds", () => {
	const rect = cssRectToPixelRect(
		{ left: -20, top: -10, width: 5000, height: 5000 },
		{ dpr: 1, frameWidth: 800, frameHeight: 600 },
	);
	assert.equal(rect.x, 0);
	assert.equal(rect.y, 0);
	assert.equal(rect.width, 800);
	assert.equal(rect.height, 600);
});

test("normalizeCropRect orders points and clamps", () => {
	const rect = normalizeCropRect({ x: 120, y: 80 }, { x: 20, y: 30 }, 200, 200);
	assert.deepEqual(rect, { x: 20, y: 30, width: 100, height: 50 });
});

test("clampPixelRect keeps minimum 1px size", () => {
	const rect = clampPixelRect({ x: 10, y: 10, width: 0, height: 0 }, 100, 100);
	assert.equal(rect.width, 1);
	assert.equal(rect.height, 1);
});

test("suggestedMarkedName uses source kind", () => {
	assert.equal(
		suggestedMarkedName({ kind: "port", port: "3000", url: "https://x" }),
		"port-3000-marked.webp",
	);
	assert.equal(
		suggestedMarkedName({ kind: "html", path: "apps/index.html" }),
		"index-marked.webp",
	);
	assert.equal(
		suggestedMarkedName({ kind: "image", path: "shot.png" }),
		"shot-marked.webp",
	);
});
