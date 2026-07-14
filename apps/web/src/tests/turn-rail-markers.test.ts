import assert from "node:assert/strict";
import { test } from "node:test";
import { measureTurnRailMarkers } from "../lib/features/session-chat/turn-rail-markers.ts";

test("first user turn marker sits at the top of the content minimap", () => {
	const scrollHeight = 2000;
	const offset = 16;
	const { positions } = measureTurnRailMarkers({
		scrollHeight,
		clientHeight: 500,
		turnScrollAnchorOffset: offset,
		anchors: [
			{ sequence: 1, absoluteTop: 0 + offset, offsetHeight: 40 },
			{ sequence: 2, absoluteTop: 1000 + offset, offsetHeight: 40 },
			{ sequence: 3, absoluteTop: 1800 + offset, offsetHeight: 40 },
		],
	});

	assert.equal(positions[1], 0);
	assert.ok(Math.abs((positions[2] as number) - 50) < 1e-9);
	assert.ok(Math.abs((positions[3] as number) - 90) < 1e-9);
});

test("turn rail markers follow document offset, not thumb travel range", () => {
	// With a tall viewport, thumb travel usable range is small. Content minimap
	// must still place a mid-document turn near 50%, not clamp into the thumb band.
	const scrollHeight = 2000;
	const clientHeight = 1500; // thumb ~75% capped to 64%, usable 36%
	const { positions } = measureTurnRailMarkers({
		scrollHeight,
		clientHeight,
		turnScrollAnchorOffset: 0,
		anchors: [{ sequence: 5, absoluteTop: 1000, offsetHeight: 80 }],
	});
	assert.ok(Math.abs((positions[5] as number) - 50) < 1e-9);
});

test("turn rail markers clamp tops into 0..100", () => {
	const { positions } = measureTurnRailMarkers({
		scrollHeight: 1000,
		clientHeight: 400,
		turnScrollAnchorOffset: 0,
		anchors: [
			{ sequence: 1, absoluteTop: -40, offsetHeight: 20 },
			{ sequence: 2, absoluteTop: 5000, offsetHeight: 20 },
		],
	});
	assert.equal(positions[1], 0);
	assert.equal(positions[2], 100);
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
