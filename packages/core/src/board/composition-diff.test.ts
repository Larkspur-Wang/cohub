import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffBoardCompositionWrite } from "./composition-diff.js";
import type { BoardComposition, BoardTrack } from "@cohub/protocol";

const track = (id: string, over: Partial<BoardTrack> = {}): BoardTrack => ({
	id,
	target: { type: "item", itemId: "title" },
	channel: "style.opacity",
	channelVersion: 1,
	interpolation: "linear",
	fill: "both",
	keyframes: [
		{ time: 0, value: 0 },
		{ time: 500, value: 1 },
	],
	metadata: {},
	...over,
} as BoardTrack);

const composition = (): Omit<BoardComposition, "revision"> => ({
	id: "intro",
	name: "Intro",
	timeline: {
		duration: 800,
		tracks: [track("title-opacity")],
		clips: [],
		markers: [],
	},
	playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
	metadata: {},
});

const trackRow = (value: BoardTrack) => ({
	id: value.id,
	channel: value.channel,
	channelVersion: value.channelVersion,
	interpolation: value.interpolation,
	fill: value.fill,
	target: value.target,
	keyframes: value.keyframes,
	metadata: value.metadata,
});

const compositionRow = {
	name: "Intro",
	duration: 800,
	playback: { loop: false, endBehavior: "hold", reducedMotion: { mode: "base" } },
	markers: [],
	metadata: {},
};

describe("diffBoardCompositionWrite", () => {
	it("reports no changes for an identical aggregate", () => {
		const next = composition();
		const first = next.timeline.tracks[0];
		assert.ok(first);
		const plan = diffBoardCompositionWrite(compositionRow, [trackRow(first)], [], next);
		assert.equal(plan.changed, false);
		assert.deepEqual(plan.changedTracks, []);
		assert.deepEqual(plan.removedTrackIds, []);
	});

	it("detects keyframe edits without serializing key order", () => {
		const next = composition();
		const first0 = next.timeline.tracks[0];
		assert.ok(first0);
		const stored = trackRow(first0);
		// Same value with keys in a different order must still be equal.
		stored.keyframes = [
			{ value: 0, time: 0 },
			{ time: 500, value: 1 },
		];
		const plan = diffBoardCompositionWrite(compositionRow, [stored], [], next);
		assert.equal(plan.changed, false);
	});

	it("detects changed track content", () => {
		const next = composition();
		const first1 = next.timeline.tracks[0];
		assert.ok(first1);
		const stored = trackRow(first1);
		stored.keyframes = [{ time: 0, value: 0 }];
		const plan = diffBoardCompositionWrite(compositionRow, [stored], [], next);
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.changedTracks.map((track) => track.id), ["title-opacity"]);
	});

	it("detects removed rows", () => {
		const next = composition();
		const first2 = next.timeline.tracks[0];
		assert.ok(first2);
		const stored = trackRow(first2);
		const plan = diffBoardCompositionWrite(compositionRow, [stored, trackRow(track("other"))], [], next);
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.removedTrackIds, ["other"]);
	});

	it("treats a missing aggregate as fully changed", () => {
		const plan = diffBoardCompositionWrite(null, [], [], composition());
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.changedTracks.map((track) => track.id), ["title-opacity"]);
	});

	it("detects header-only changes", () => {
		const next = composition();
		const first3 = next.timeline.tracks[0];
		assert.ok(first3);
		const plan = diffBoardCompositionWrite({ ...compositionRow, name: "Renamed" }, [trackRow(first3)], [], next);
		assert.equal(plan.changed, true);
		assert.deepEqual(plan.changedTracks, []);
	});
});
