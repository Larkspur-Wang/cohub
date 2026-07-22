import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	hexNumberToCss,
	parseCssColorToNumber,
} from "$lib/canvas/core/css-color";
import {
	buildFallbackShapeColors,
	canvasColorCssVar,
	pickCanvasColor,
	resolveCanvasColor,
} from "$lib/canvas/core/palette";

describe("canvas css color parsing", () => {
	it("parses hex and rgb forms", () => {
		assert.equal(parseCssColorToNumber("#ff5a1f"), 0xff5a1f);
		assert.equal(parseCssColorToNumber("#abc"), 0xaabbcc);
		assert.equal(parseCssColorToNumber("rgb(56, 189, 248)"), 0x38bdf8);
		assert.equal(parseCssColorToNumber("rgba(56 189 248 / 0.8)"), 0x38bdf8);
		assert.equal(parseCssColorToNumber("rgb(100% 0% 0%)"), 0xff0000);
		assert.equal(parseCssColorToNumber(""), null);
		assert.equal(parseCssColorToNumber("not-a-color"), null);
	});

	it("round-trips hex numbers", () => {
		assert.equal(hexNumberToCss(0xff5a1f), "#ff5a1f");
		assert.equal(hexNumberToCss(0x0), "#000000");
	});
});

describe("canvas shape palette tokens", () => {
	it("exposes stable CSS var names", () => {
		assert.equal(
			canvasColorCssVar("brand", "stroke"),
			"--canvas-color-brand-stroke",
		);
		assert.equal(canvasColorCssVar("blue", "fill"), "--canvas-color-blue-fill");
		assert.equal(
			canvasColorCssVar("rose", "label"),
			"--canvas-color-rose-label",
		);
	});

	it("falls back to hard-coded tables without live colors", () => {
		const dark = resolveCanvasColor("blue", "dark");
		const light = resolveCanvasColor("blue", "light");
		assert.equal(dark.stroke, 0x38bdf8);
		assert.equal(light.stroke, 0x2563eb);
		assert.equal(
			resolveCanvasColor("unknown", "dark").stroke,
			resolveCanvasColor("brand", "dark").stroke,
		);
	});

	it("prefers live shape colors when provided", () => {
		const colors = buildFallbackShapeColors("dark");
		colors.blue = { stroke: 0x112233, fill: 0x112233, label: 0xffffff };
		assert.equal(pickCanvasColor(colors, "blue", "dark").stroke, 0x112233);
		assert.equal(
			pickCanvasColor(colors, "missing", "dark").stroke,
			colors.brand.stroke,
		);
	});
});
