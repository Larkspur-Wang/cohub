import assert from "node:assert/strict";
import { test } from "node:test";
import {
	resolveOverlayInputClip,
	resolveOverlayStyle,
} from "$lib/features/space/modules/desktop-layer-geometry";

const viewport = { width: 1000, height: 600 };

test("an overlay without a size fills the whole layer", () => {
	assert.equal(
		resolveOverlayStyle({}, viewport),
		"left: 0px; top: 0px; width: 1000px; height: 600px",
	);
});

test("each axis is resolved on its own", () => {
	assert.equal(
		resolveOverlayStyle({ width: 320 }, viewport),
		"left: 0px; top: 0px; width: 320px; height: 600px",
	);
	assert.equal(
		resolveOverlayStyle({ anchor: "bottom-right", height: 100, y: 12 }, viewport),
		"left: 0px; top: 488px; width: 1000px; height: 100px",
	);
});

test("size is clamped to the viewport", () => {
	assert.equal(
		resolveOverlayStyle({ width: 5000, height: 0 }, viewport),
		"left: 0px; top: 0px; width: 1000px; height: 1px",
	);
});

test("the overlay never leaves the viewport, whatever the anchor", () => {
	const size = { width: 400, height: 100 };
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "top-left", x: 900, y: -20 }, viewport),
		"left: 600px; top: 0px; width: 400px; height: 100px",
	);
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "bottom-right", x: 900, y: 12 }, viewport),
		"left: 0px; top: 488px; width: 400px; height: 100px",
	);
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "center", x: 800, y: 0 }, viewport),
		"left: 600px; top: 250px; width: 400px; height: 100px",
	);
});

test("anchors measure the offset from their own edge", () => {
	const size = { width: 100, height: 100 };
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "top-right", x: 12, y: 12 }, viewport),
		"left: 888px; top: 12px; width: 100px; height: 100px",
	);
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "bottom-left", x: 12, y: 12 }, viewport),
		"left: 12px; top: 488px; width: 100px; height: 100px",
	);
	assert.equal(
		resolveOverlayStyle({ ...size, anchor: "center", x: 10, y: -10 }, viewport),
		"left: 460px; top: 240px; width: 100px; height: 100px",
	);
});

test("input region maps to pointer-events and clip-path", () => {
	assert.equal(resolveOverlayInputClip("none"), "pointer-events: none");
	assert.equal(resolveOverlayInputClip("all"), "");
	assert.equal(resolveOverlayInputClip([]), "pointer-events: none");
	assert.equal(
		resolveOverlayInputClip([{ x: 0, y: 0, width: 80, height: 80 }]),
		"clip-path: polygon(0px 0px, 80px 0px, 80px 80px, 0px 80px)",
	);
	assert.equal(
		resolveOverlayInputClip([
			{ x: 0, y: 0, width: 10, height: 10 },
			{ x: 20, y: 20, width: 10, height: 10 },
		]),
		"clip-path: path('M0 0h10v10h-10z M20 20h10v10h-10z')",
	);
});
