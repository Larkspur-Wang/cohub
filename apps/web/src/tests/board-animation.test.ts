import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	BoardComposition,
	BoardPlaybackSnapshot,
	BoardProceduralClip,
} from "@neta-art/cohub";
import {
	compileComposition,
	sampleCompositionTracks,
	sampleTrack,
	track,
} from "@neta-art/cohub/board";
import {
	clipSampleAt,
	compositionItemPoses,
	playbackSampleAt,
	samplePathPose,
	timelinePosition,
} from "$lib/board/runtime/animation-core";
import {
	prepareCameraFocusClips,
	resolveCameraFocusPose,
} from "$lib/board/runtime/pixi-animation";

const target = { type: "item" as const, itemId: "title" };

function intro(): BoardComposition {
	return compileComposition({
		id: "intro",
		name: "Intro",
		duration: 1_000,
		tracks: [
			{
				id: "opacity",
				target,
				channel: "style.opacity",
				fill: "both",
				interpolation: "linear",
				keyframes: [
					{ time: 0, value: 0 },
					{ time: 1_000, value: 1, easing: "ease-out-cubic" },
				],
			},
			{
				id: "translation",
				target,
				channel: "transform.translation",
				fill: "both",
				interpolation: "linear",
				keyframes: [
					{ time: 0, value: { x: 0, y: 24 } },
					{ time: 500, value: { x: 0, y: 0 } },
				],
			},
		],
		markers: [{ id: "poster", time: 800, metadata: {} }],
		playback: {
			loop: false,
			endBehavior: "hold",
			reducedMotion: { mode: "marker", markerId: "poster" },
		},
	});
}

test("Composition samples typed channels at deterministic times", () => {
	const composition = intro();
	assert.deepEqual(sampleCompositionTracks(composition, 0), [
		{ target, channel: "style.opacity", value: 0 },
		{ target, channel: "transform.translation", value: { x: 0, y: 24 } },
	]);
	const middle = compositionItemPoses(composition, 500).get("title");
	assert.ok(middle);
	assert.equal(middle.alpha, 0.875);
	assert.deepEqual({ x: middle.x, y: middle.y }, { x: 0, y: 0 });
	assert.equal(compositionItemPoses(composition, 1_000).get("title")?.alpha, 1);
});

test("Track fill falls back to the Board outside its authored interval", () => {
	const value = track({
		id: "opacity",
		target,
		channel: "style.opacity",
		interpolation: "linear",
		fill: "none",
		keyframes: [
			{ time: 200, value: 0 },
			{ time: 800, value: 1 },
		],
	});
	assert.equal(sampleTrack(value, 100), null);
	assert.equal(sampleTrack(value, 900), null);
	assert.equal(sampleTrack({ ...value, fill: "both" }, 100)?.value, 0);
	assert.equal(sampleTrack({ ...value, fill: "both" }, 900)?.value, 1);
});

test("Step tracks never invent interpolation", () => {
	const value = track({
		id: "rotation",
		target,
		channel: "transform.rotation",
		interpolation: "step",
		fill: "both",
		keyframes: [
			{ time: 0, value: 0 },
			{ time: 500, value: Math.PI },
		],
	});
	assert.equal(sampleTrack(value, 499)?.value, 0);
	assert.equal(sampleTrack(value, 500)?.value, Math.PI);
});

test("Playback waiting samples zero without advancing", () => {
	const playback: BoardPlaybackSnapshot = {
		boardId: "11111111-1111-4111-8111-111111111111",
		playbackId: "22222222-2222-4222-8222-222222222222",
		compositionId: "intro",
		compositionRevision: 1,
		playbackRevision: 1,
		status: "playing",
		position: 0,
		effectiveAt: 1_500,
		timeScale: 1,
		seed: "intro",
	};
	assert.deepEqual(playbackSampleAt(playback, 1_000, 1_000), {
		position: 0,
		ended: false,
		waiting: true,
	});
	assert.deepEqual(playbackSampleAt(playback, 1_000, 2_000), {
		position: 500,
		ended: false,
		waiting: false,
	});
});

test("Timeline loop wraps directly to zero", () => {
	assert.equal(timelinePosition(1_250, 1_000, true), 250);
	assert.equal(timelinePosition(1_250, 1_000, false), 1_000);
	assert.equal(timelinePosition(-100, 1_000, true), 900);
});

test("Procedural clip fill has WAAPI-style boundaries", () => {
	const clip: BoardProceduralClip = {
		id: "reveal",
		kind: "text.reveal",
		kindVersion: 1,
		target,
		start: 200,
		duration: 400,
		layer: "content",
		fill: "both",
		easing: "linear",
		params: {},
		assetRefs: [],
		seed: "reveal",
		metadata: {},
	};
	assert.deepEqual(clipSampleAt(clip, 0), {
		localTime: 0,
		progress: 0,
		boundary: "before",
	});
	assert.deepEqual(clipSampleAt(clip, 400), {
		localTime: 200,
		progress: 0.5,
		boundary: "active",
	});
	assert.deepEqual(clipSampleAt(clip, 800), {
		localTime: 400,
		progress: 1,
		boundary: "after",
	});
});

test("Motion paths remain a procedural multi-property behavior", () => {
	const clip: BoardProceduralClip = {
		id: "path",
		kind: "motion.path",
		kindVersion: 1,
		target,
		start: 0,
		duration: 1_000,
		layer: "content",
		fill: "none",
		easing: "linear",
		params: {
			points: [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			],
			orient: true,
		},
		assetRefs: [],
		seed: "path",
		metadata: {},
	};
	assert.deepEqual(samplePathPose(clip, 500), { x: 50, y: 0, rotation: 0 });
});

test("Camera focus clips are indexed within their Composition", () => {
	const composition = compileComposition({
		id: "camera",
		name: "Camera",
		duration: 1_000,
		clips: [
			{
				id: "focus",
				kind: "camera.focus",
				target: { type: "camera" },
				start: 0,
				duration: 500,
				fill: "forwards",
				easing: "linear",
				params: {
					focus: { type: "item", itemId: "title" },
					fit: "contain",
					padding: 0,
				},
				seed: "focus",
			},
		],
	});
	const prepared = prepareCameraFocusClips([composition]).get("camera") ?? [];
	assert.equal(prepared.length, 1);
	const pose = resolveCameraFocusPose({
		clips: prepared,
		position: 250,
		base: { x: 0, y: 0, zoom: 1 },
		resolveTarget: () => ({ x: 100, y: 50, zoom: 2 }),
	});
	assert.ok(pose);
	assert.equal(pose.x, 50);
	assert.equal(pose.y, 25);
	assert.equal(pose.scaleX, 1.5);
});
