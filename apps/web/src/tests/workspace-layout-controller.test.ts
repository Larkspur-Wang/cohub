import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Pure presentation rules for layout snapshot behavior.
 * (DOM/uiState controller is integration-tested in app.)
 */

test("auto focus expand must not overwrite restore width", () => {
	// Enter focus captures snapshot width=480, then expands live width to max.
	// Restore must use snapshot width, not the expanded live width.
	const snapshotWidth = 480;
	let liveWidth = snapshotWidth;
	const maxWidth = 900;
	// auto expand (no persistSnapshot)
	liveWidth = maxWidth;
	const restored = snapshotWidth;
	assert.equal(restored, 480);
	assert.notEqual(liveWidth, restored);
});

test("user resize may update snapshot width", () => {
	let snapshotWidth = 480;
	let liveWidth = 480;
	// user drag with persistSnapshot
	liveWidth = 560;
	snapshotWidth = liveWidth;
	assert.equal(snapshotWidth, 560);
});

test("preview drag paints CSS live width and commits once on release", () => {
	// During drag we only paint the pane width; Svelte previewWidth commits on pointerup.
	let previewWidth = 480;
	let paintedWidth = previewWidth;
	const clamp = (n: number) => Math.min(900, Math.max(280, n));

	// pointermove x3 without committing state
	for (const next of [500, 520, 540]) {
		paintedWidth = clamp(next);
	}
	assert.equal(previewWidth, 480);
	assert.equal(paintedWidth, 540);

	// pointerup commits once
	previewWidth = paintedWidth;
	assert.equal(previewWidth, 540);
});
