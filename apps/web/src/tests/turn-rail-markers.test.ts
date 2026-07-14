import assert from "node:assert/strict";
import { test } from "node:test";
import { measureTurnRailMarkers } from "../lib/features/session-chat/turn-rail-markers.ts";

test("first user turn marker is flush with the rail top", () => {
	const { positions } = measureTurnRailMarkers({
		scrollHeight: 2000,
		clientHeight: 500,
		anchors: [
			// Timeline padding / first bubble top is not zero in the scroll box.
			{ sequence: 1, absoluteTop: 32, offsetHeight: 40 },
			{ sequence: 2, absoluteTop: 1032, offsetHeight: 40 },
			{ sequence: 3, absoluteTop: 1832, offsetHeight: 40 },
		],
	});

	assert.equal(positions[1], 0);
	// (1032 - 32) / (2000 - 32) * 100
	assert.ok(Math.abs((positions[2] as number) - (1000 / 1968) * 100) < 1e-9);
	assert.ok(Math.abs((positions[3] as number) - (1800 / 1968) * 100) < 1e-9);
});

test("marker placement ignores viewport size / thumb travel", () => {
	const tall = measureTurnRailMarkers({
		scrollHeight: 2000,
		clientHeight: 1500,
		anchors: [
			{ sequence: 1, absoluteTop: 24, offsetHeight: 40 },
			{ sequence: 5, absoluteTop: 1024, offsetHeight: 80 },
		],
	});
	const short = measureTurnRailMarkers({
		scrollHeight: 2000,
		clientHeight: 400,
		anchors: [
			{ sequence: 1, absoluteTop: 24, offsetHeight: 40 },
			{ sequence: 5, absoluteTop: 1024, offsetHeight: 80 },
		],
	});
	assert.equal(tall.positions[1], 0);
	assert.equal(short.positions[1], 0);
	assert.equal(tall.positions[5], short.positions[5]);
	assert.ok(
		Math.abs((tall.positions[5] as number) - (1000 / 1976) * 100) < 1e-9,
	);
});

test("turn rail markers clamp tops into 0..100", () => {
	const { positions } = measureTurnRailMarkers({
		scrollHeight: 1000,
		clientHeight: 400,
		anchors: [
			{ sequence: 1, absoluteTop: 10, offsetHeight: 20 },
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
		anchors: [
			{ sequence: Number.NaN, absoluteTop: 0, offsetHeight: 20 },
			{ sequence: 4, absoluteTop: 200, offsetHeight: 20 },
		],
	});
	assert.equal(Object.keys(positions).length, 1);
	assert.ok(positions[4] != null);
	// Only one finite anchor → it is the origin.
	assert.equal(positions[4], 0);
});
