import assert from "node:assert/strict";
import { test } from "node:test";
import {
	resolveOverlayInputClip,
	resolveOverlayStyle,
} from "$lib/features/space/modules/desktop-layer-geometry";

const viewport = { width: 1000, height: 600 };

test("an overlay without a size fills the whole layer", () => {
	assert.equal(resolveOverlayStyle({}, viewport), "inset: 0");
});

test("overlay geometry is clamped to the viewport", () => {
	const style = resolveOverlayStyle(
		{ anchor: "top-left", x: 5000, y: -20, width: 80, height: 9000 },
		viewport,
	);
	assert.match(style, /width: 80px/);
	assert.match(style, /height: 600px/);
	assert.match(style, /left: 1000px/);
	assert.match(style, /top: 0px/);
});

test("center anchor positions relative to the viewport middle", () => {
	const style = resolveOverlayStyle(
		{ anchor: "center", x: 10, y: -10, width: 100, height: 100 },
		viewport,
	);
	assert.match(style, /left: calc\(50% \+ 10px\)/);
	assert.match(style, /top: calc\(50% \+ -10px\)/);
	assert.match(style, /translate\(-50%, -50%\)/);
});

test("input region maps to pointer-events and clip-path", () => {
	assert.equal(resolveOverlayInputClip("none"), "pointer-events: none");
	assert.equal(resolveOverlayInputClip("all"), "");
	assert.equal(resolveOverlayInputClip([]), "pointer-events: none");
	assert.match(
		resolveOverlayInputClip([{ x: 0, y: 0, width: 80, height: 80 }]),
		/^clip-path: polygon\(0px 0px, 80px 0px, 80px 80px, 0px 80px\)$/,
	);
	assert.match(
		resolveOverlayInputClip([
			{ x: 0, y: 0, width: 10, height: 10 },
			{ x: 20, y: 20, width: 10, height: 10 },
		]),
		/^clip-path: path\('M0 0h10v10h-10z M20 20h10v10h-10z'\)$/,
	);
});
