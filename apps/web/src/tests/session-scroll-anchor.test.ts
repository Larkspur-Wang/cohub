import assert from "node:assert/strict";
import { test } from "node:test";
import {
	isSessionScrollAnchor,
	isSessionScrollAnchorTurnLoaded,
	resolveSessionScrollAnchorTargetIndex,
	resolveSessionScrollRestore,
	type SessionScrollAnchor,
} from "../lib/features/session-chat/session-scroll-controller.svelte.ts";

const anchor: SessionScrollAnchor = {
	itemKey: "turn:10:process",
	turnSequence: 10,
	kind: "process",
	offset: -24,
	updatedAt: 1_000,
};

test("accepts version-two semantic anchors", () => {
	assert.equal(isSessionScrollAnchor(anchor), true);
});

test("rejects ambiguous legacy numeric anchors", () => {
	assert.equal(
		isSessionScrollAnchor({ sequence: 10, offset: -24, updatedAt: 1_000 }),
		false,
	);
});

test("checks the anchor's actual turn sequence", () => {
	assert.equal(
		isSessionScrollAnchorTurnLoaded(anchor, [
			{ sequence: 1 },
			{ sequence: 10 },
		]),
		true,
	);
	assert.equal(
		isSessionScrollAnchorTurnLoaded(anchor, [{ sequence: 1 }, { sequence: 2 }]),
		false,
	);
});

test("resolves process turn 10 without colliding with user turn 1", () => {
	const targets = [
		{ itemKey: "turn:1:user", turnSequence: 1, kind: "user" as const },
		{ itemKey: "turn:10:process", turnSequence: 10, kind: "process" as const },
	];
	assert.equal(resolveSessionScrollAnchorTargetIndex(anchor, targets), 1);
});

test("falls back to semantic turn and kind when an item key changes", () => {
	const targets = [
		{ itemKey: "turn:1:user", turnSequence: 1, kind: "user" as const },
		{
			itemKey: "turn:10:process:final",
			turnSequence: 10,
			kind: "process" as const,
		},
	];
	assert.equal(
		resolveSessionScrollAnchorTargetIndex(
			{ ...anchor, itemKey: "turn:10:process:streaming" },
			targets,
		),
		1,
	);
});

test("does not fall back to a different item kind in the same turn", () => {
	assert.equal(
		resolveSessionScrollAnchorTargetIndex(anchor, [
			{ itemKey: "turn:10:user", turnSequence: 10, kind: "user" },
		]),
		-1,
	);
});

test("keeps restore pending while the anchor target is not scrollable yet", () => {
	assert.deepEqual(
		resolveSessionScrollRestore({
			anchorTop: 640,
			anchorOffset: -40,
			scrollHeight: 500,
			clientHeight: 500,
		}),
		{ scrollTop: 0, reached: false },
	);
});

test("reaches the same anchor after timeline layout expands", () => {
	assert.deepEqual(
		resolveSessionScrollRestore({
			anchorTop: 640,
			anchorOffset: -40,
			scrollHeight: 1800,
			clientHeight: 500,
		}),
		{ scrollTop: 600, reached: true },
	);
});

test("keeps the old bottom position when newer content was appended", () => {
	assert.deepEqual(
		resolveSessionScrollRestore({
			anchorTop: 900,
			anchorOffset: -100,
			scrollHeight: 2_200,
			clientHeight: 500,
		}),
		{ scrollTop: 800, reached: true },
	);
});
