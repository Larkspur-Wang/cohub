import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	hexNumberToCss,
	parseCssColorToNumber,
} from "$lib/board/core/css-color";
import {
	boardColorCssVar,
	buildFallbackShapeColors,
	pickBoardColor,
	resolveBoardColor,
} from "$lib/board/core/palette";

describe("board css color parsing", () => {
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

describe("board shape palette tokens", () => {
	it("exposes stable CSS var names", () => {
		assert.equal(
			boardColorCssVar("brand", "stroke"),
			"--board-color-brand-stroke",
		);
		assert.equal(boardColorCssVar("blue", "fill"), "--board-color-blue-fill");
		assert.equal(boardColorCssVar("rose", "label"), "--board-color-rose-label");
	});

	it("falls back to hard-coded tables without live colors", () => {
		const dark = resolveBoardColor("blue", "dark");
		const light = resolveBoardColor("blue", "light");
		assert.equal(dark.stroke, 0x38bdf8);
		assert.equal(light.stroke, 0x2563eb);
		assert.equal(
			resolveBoardColor("unknown", "dark").stroke,
			resolveBoardColor("brand", "dark").stroke,
		);
	});

	it("prefers live shape colors when provided", () => {
		const colors = buildFallbackShapeColors("dark");
		colors.blue = { stroke: 0x112233, fill: 0x112233, label: 0xffffff };
		assert.equal(pickBoardColor(colors, "blue", "dark").stroke, 0x112233);
		assert.equal(
			pickBoardColor(colors, "missing", "dark").stroke,
			colors.brand.stroke,
		);
	});
});
