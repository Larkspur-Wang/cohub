import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildViewportContentBlock,
	buildViewportReferencesText,
	formatViewportContextLabel,
	viewportContextId,
} from "@cohub/protocol";
import { visibleWorldRect } from "../lib/canvas/canvas-geometry";
import {
	activeViewportSourceId,
	nextDismissedIdsAfterSourceChange,
} from "../lib/features/session-chat/viewport-context-controller.svelte.ts";

test("visibleWorldRect converts camera offset into world bounds", () => {
	const rect = visibleWorldRect({ x: -100, y: -50, zoom: 2 }, 400, 300);
	assert.deepEqual(rect, {
		x: 50,
		y: 25,
		width: 200,
		height: 150,
	});
});

test("viewport reference text stays agent-readable", () => {
	const text = buildViewportReferencesText([
		{
			kind: "file",
			path: "src/main.ts",
			visibleLines: { start: 8, end: 32 },
		},
		{
			kind: "port",
			port: "5173",
			url: "https://preview.example",
		},
	]);
	assert.equal(
		text,
		[
			"Viewport:",
			"- file: `src/main.ts` (L8-32)",
			"- port: `5173` (https://preview.example)",
		].join("\n"),
	);
});

test("viewport content block meta round-trips for timeline chips", () => {
	const contexts = [
		{
			kind: "canvas" as const,
			path: "board.covas",
			camera: { x: 0, y: 0, zoom: 1 },
			selectedNodes: [{ id: "card-1", type: "text", title: "Note" }],
		},
	];
	const block = buildViewportContentBlock(contexts);
	assert.ok(block);
	assert.equal(block?._meta?.attachmentKind, "viewport");
	assert.equal(viewportContextId(contexts[0]), "canvas:board.covas");
	assert.equal(
		formatViewportContextLabel(contexts[0]),
		"board.covas · 1 selected",
	);
});

test("activeViewportSourceId matches viewportContextId shape", () => {
	assert.equal(
		activeViewportSourceId({ kind: "file", path: "src/main.ts" }),
		"file:src/main.ts",
	);
	assert.equal(
		activeViewportSourceId({ kind: "canvas", path: "board.covas" }),
		"canvas:board.covas",
	);
	assert.equal(
		activeViewportSourceId({
			kind: "port",
			port: "5173",
			url: "https://preview.example",
		}),
		"port:5173",
	);
	assert.equal(activeViewportSourceId(null), null);
});

test("dismiss sticks across send; only real source change prunes it", () => {
	const board = "canvas:board.covas";
	const other = "file:src/main.ts";
	const dismissed = [board];

	// Closing preview keeps dismiss so reopening the same source stays quiet.
	assert.deepEqual(nextDismissedIdsAfterSourceChange(dismissed, board, null), [
		board,
	]);
	// Same source again — no-op (setActiveSource short-circuits before this,
	// but the helper itself must not clear).
	assert.deepEqual(nextDismissedIdsAfterSourceChange(dismissed, board, board), [
		board,
	]);
	// Switching to another source drops the old dismiss so a later return can auto-attach.
	assert.deepEqual(
		nextDismissedIdsAfterSourceChange(dismissed, board, other),
		[],
	);
	// Unrelated dismiss ids are preserved when pruning the previous source.
	assert.deepEqual(
		nextDismissedIdsAfterSourceChange([board, other], board, other),
		[other],
	);
});
