import assert from "node:assert/strict";
import { test } from "node:test";
import { measureTurnRailMarkers } from "../lib/features/session-chat/turn-rail-markers.ts";

test("turn rail markers share the scrollbar thumb travel range", () => {
	const scrollHeight = 2000;
	const clientHeight = 500;
	const maxScroll = scrollHeight - clientHeight;
	const thumbHeightPercent = Math.min(
		64,
		Math.max(6, (clientHeight / scrollHeight) * 100),
	);
	const usable = 100 - thumbHeightPercent;
	const offset = 16;

	const { positions, heights } = measureTurnRailMarkers({
		scrollHeight,
		clientHeight,
		turnScrollAnchorOffset: offset,
		anchors: [
			{ sequence: 1, absoluteTop: 0 + offset, offsetHeight: 40 },
			{ sequence: 2, absoluteTop: 750 + offset, offsetHeight: 40 },
			{ sequence: 3, absoluteTop: maxScroll + offset, offsetHeight: 40 },
		],
	});

	assert.equal(positions[1], 0);
	const mid = positions[2];
	assert.equal(typeof mid, "number");
	assert.ok(Math.abs((mid as number) - (750 / maxScroll) * usable) < 1e-9);
	assert.equal(positions[3], usable);
	const h1 = heights[1];
	const h2 = heights[2];
	assert.equal(typeof h1, "number");
	assert.equal(typeof h2, "number");
	assert.ok((h1 as number) >= 8 && (h1 as number) <= 22);
	assert.ok((h2 as number) >= 8 && (h2 as number) <= 22);
});

test("turn rail markers clamp tops into the usable range", () => {
	const { positions } = measureTurnRailMarkers({
		scrollHeight: 1000,
		clientHeight: 400,
		turnScrollAnchorOffset: 0,
		anchors: [
			{ sequence: 1, absoluteTop: -40, offsetHeight: 20 },
			{ sequence: 2, absoluteTop: 5000, offsetHeight: 20 },
		],
	});

	const thumbHeightPercent = Math.min(64, Math.max(6, (400 / 1000) * 100));
	const usable = 100 - thumbHeightPercent;
	assert.equal(positions[1], 0);
	assert.equal(positions[2], usable);
});

test("turn rail markers ignore non-finite sequences", () => {
	const { positions } = measureTurnRailMarkers({
		scrollHeight: 800,
		clientHeight: 400,
		turnScrollAnchorOffset: 0,
		anchors: [
			{ sequence: Number.NaN, absoluteTop: 0, offsetHeight: 20 },
			{ sequence: 4, absoluteTop: 200, offsetHeight: 20 },
		],
	});
	assert.equal(Object.keys(positions).length, 1);
	assert.ok(positions[4] != null);
});
