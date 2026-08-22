import assert from "node:assert/strict";
import { test } from "node:test";
import {
	findCurrentTurnAnchorSequence,
	measureTurnRailMarkers,
	type TurnRailMarkerAnchor,
} from "../lib/features/session-chat/turn-rail-markers.ts";

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

const geometry: TurnRailMarkerAnchor[] = [
	{ sequence: 1, absoluteTop: 100, offsetHeight: 40 },
	{ sequence: 2, absoluteTop: 500, offsetHeight: 40 },
	{ sequence: 3, absoluteTop: 900, offsetHeight: 40 },
	{ sequence: 4, absoluteTop: 1300, offsetHeight: 40 },
];

/** Reference implementation of the previous nearest-node viewport scan. */
function legacyScan(
	anchors: TurnRailMarkerAnchor[],
	probe: number,
): number | null {
	let best: { sequence: number; distance: number } | null = null;
	for (const anchor of anchors) {
		const distance =
			anchor.absoluteTop <= probe
				? probe - anchor.absoluteTop
				: anchor.absoluteTop - probe + 1000;
		if (!best || distance < best.distance) {
			best = { sequence: anchor.sequence, distance };
		}
	}
	return best?.sequence ?? null;
}

test("current turn matches the previous nearest-node scan", () => {
	for (let probe = 0; probe <= 1400; probe += 37) {
		assert.equal(
			findCurrentTurnAnchorSequence(geometry, probe),
			legacyScan(geometry, probe),
			`probe ${probe}`,
		);
	}
});

test("current turn stays with the turn containing the probe", () => {
	// The previous scan jumped ahead once the containing turn started more
	// than 1000px above the probe; spanning its content is the useful reading.
	const spread: TurnRailMarkerAnchor[] = [
		{ sequence: 1, absoluteTop: 0, offsetHeight: 40 },
		{ sequence: 2, absoluteTop: 3000, offsetHeight: 40 },
	];
	assert.equal(findCurrentTurnAnchorSequence(spread, 1500), 1);
});

test("current turn falls back to the first anchor above the probe", () => {
	assert.equal(findCurrentTurnAnchorSequence(geometry, 0), 1);
	assert.equal(findCurrentTurnAnchorSequence(geometry, 50), 1);
});

test("current turn picks the closest anchor at or above the probe", () => {
	// Between turns 2 and 3 → turn 2 is the closest at-or-above.
	assert.equal(findCurrentTurnAnchorSequence(geometry, 700), 2);
	assert.equal(findCurrentTurnAnchorSequence(geometry, 899), 2);
	assert.equal(findCurrentTurnAnchorSequence(geometry, 900), 3);
});

test("current turn handles empty geometry", () => {
	assert.equal(findCurrentTurnAnchorSequence([], 500), null);
});
