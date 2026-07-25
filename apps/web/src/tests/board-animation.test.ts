import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardClip, BoardPlaybackSnapshot } from "@neta-art/cohub";
import {
	clipSampleAt,
	composePose,
	createPose,
	hashUnit,
	playbackPosition,
	sampleKeyframePose,
	samplePathPose,
} from "$lib/board/runtime/animation-core";

function makeClip(overrides: Partial<BoardClip> = {}): BoardClip {
	return {
		id: "clip",
		sequenceId: "sequence",
		kind: "motion.keyframes",
		kindVersion: 1,
		target: { type: "node", nodeId: "node" },
		start: 100,
		duration: 400,
		layer: "content",
		fill: "none",
		easing: "linear",
		params: {},
		keyframes: [],
		assetRefs: [],
		seed: "seed",
		metadata: {},
		...overrides,
	};
}

test("clip fill samples only the requested playback boundaries", () => {
	assert.equal(clipSampleAt(makeClip(), 50), null);
	assert.equal(clipSampleAt(makeClip(), 550), null);
	assert.deepEqual(clipSampleAt(makeClip({ fill: "both" }), 50), {
		localTime: 0,
		progress: 0,
		boundary: "before",
	});
	assert.deepEqual(clipSampleAt(makeClip({ fill: "forwards" }), 550), {
		localTime: 400,
		progress: 1,
		boundary: "after",
	});
});

test("keyframe and path sampling are absolute-time deterministic", () => {
	const keyframes = makeClip({
		keyframes: [
			{ at: 0, value: { x: 0, scale: 1 } },
			{ at: 400, value: { x: 80, scale: 2 } },
		],
	});
	assert.deepEqual(sampleKeyframePose(keyframes, 200), { x: 40, scale: 1.5 });
	assert.deepEqual(
		sampleKeyframePose(
			makeClip({
				keyframes: [
					{ at: 0, value: { x: 0 } },
					{ at: 0.5, value: { x: 10 } },
				],
			}),
			0.25,
		),
		{ x: 5 },
	);

	const path = makeClip({
		kind: "motion.path",
		params: {
			points: [
				{ x: 0, y: 0 },
				{ x: 30, y: 0 },
				{ x: 30, y: 70 },
			],
		},
	});
	assert.deepEqual(samplePathPose(path, 200), { x: 30, y: 20 });
});

test("pose channels compose instead of overwriting one another", () => {
	const pose = createPose();
	composePose(pose, { x: 10, scale: 1.2, alpha: 0.5 });
	composePose(pose, { y: 5, scaleX: 2, rotation: 0.25 });
	assert.deepEqual(pose, {
		x: 10,
		y: 5,
		scaleX: 2.4,
		scaleY: 1.2,
		rotation: 0.25,
		alpha: 0.5,
	});
});

test("playback and seeded random values can be reconstructed after reconnect", () => {
	const playback: BoardPlaybackSnapshot = {
		boardId: "11111111-1111-4111-8111-111111111111",
		playbackId: "22222222-2222-4222-8222-222222222222",
		sequenceId: "sequence",
		sequenceRevision: 3,
		playbackRevision: 7,
		status: "playing",
		position: 250,
		effectiveAt: 1_000,
		timeScale: 1.5,
		seed: "battle",
	};
	assert.equal(playbackPosition(playback, 1_200), 550);
	assert.equal(
		hashUnit("battle:clip:4:angle"),
		hashUnit("battle:clip:4:angle"),
	);
	assert.notEqual(
		hashUnit("battle:clip:4:angle"),
		hashUnit("battle:clip:5:angle"),
	);
});
