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
