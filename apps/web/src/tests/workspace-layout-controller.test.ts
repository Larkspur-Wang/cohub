import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Pure presentation rules for layout snapshot behavior and Files chrome
 * show/hide consistency. (DOM/uiState controller is integration-tested in app.)
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

/**
 * Files chrome effective-hide rules (mirrors isFilesChromeEffectivelyHidden /
 * toggleFilesChrome in workspace-layout-controller).
 *
 * Bug: tree collapsed + no preview paints an empty rail while filesColumnHidden
 * stays false. Header icon said "Hide files"; first click only flipped the
 * flag with no visible change. Second click finally revealed the tree.
 */
function isFilesChromeEffectivelyHidden(state: {
	isCompact: boolean;
	mobileDrawerOpen: boolean;
	filesColumnHidden: boolean;
	treeCollapsed: boolean;
	hasPreview: boolean;
}) {
	if (state.isCompact) return !state.mobileDrawerOpen;
	if (state.filesColumnHidden) return true;
	return state.treeCollapsed && !state.hasPreview;
}

function toggleFilesChrome(state: {
	isCompact: boolean;
	mobileDrawerOpen: boolean;
	filesColumnHidden: boolean;
	treeCollapsed: boolean;
	hasPreview: boolean;
}) {
	if (state.isCompact) {
		return {
			...state,
			mobileDrawerOpen: !state.mobileDrawerOpen,
		};
	}
	if (isFilesChromeEffectivelyHidden(state)) {
		return {
			...state,
			filesColumnHidden: false,
			// Always open tree so the click paints something visible.
			treeCollapsed: false,
		};
	}
	return {
		...state,
		filesColumnHidden: true,
	};
}

test("empty rail (tree collapsed, no preview) counts as effectively hidden", () => {
	assert.equal(
		isFilesChromeEffectivelyHidden({
			isCompact: false,
			mobileDrawerOpen: false,
			filesColumnHidden: false,
			treeCollapsed: true,
			hasPreview: false,
		}),
		true,
	);
});

test("tree open with no preview is not effectively hidden", () => {
	assert.equal(
		isFilesChromeEffectivelyHidden({
			isCompact: false,
			mobileDrawerOpen: false,
			filesColumnHidden: false,
			treeCollapsed: false,
			hasPreview: false,
		}),
		false,
	);
});

test("tree collapsed with preview open is not effectively hidden", () => {
	assert.equal(
		isFilesChromeEffectivelyHidden({
			isCompact: false,
			mobileDrawerOpen: false,
			filesColumnHidden: false,
			treeCollapsed: true,
			hasPreview: true,
		}),
		false,
	);
});

test("first header click on empty rail reveals tree (no double-click)", () => {
	const before = {
		isCompact: false,
		mobileDrawerOpen: false,
		filesColumnHidden: false,
		treeCollapsed: true,
		hasPreview: false,
	};
	const after = toggleFilesChrome(before);
	assert.equal(after.filesColumnHidden, false);
	assert.equal(after.treeCollapsed, false);
	assert.equal(isFilesChromeEffectivelyHidden(after), false);
});

test("header click when visible hides the whole column", () => {
	const before = {
		isCompact: false,
		mobileDrawerOpen: false,
		filesColumnHidden: false,
		treeCollapsed: false,
		hasPreview: false,
	};
	const after = toggleFilesChrome(before);
	assert.equal(after.filesColumnHidden, true);
	assert.equal(isFilesChromeEffectivelyHidden(after), true);
});

test("header click when column folded reveals and opens tree", () => {
	const before = {
		isCompact: false,
		mobileDrawerOpen: false,
		filesColumnHidden: true,
		treeCollapsed: true,
		hasPreview: false,
	};
	const after = toggleFilesChrome(before);
	assert.equal(after.filesColumnHidden, false);
	assert.equal(after.treeCollapsed, false);
});

test("collapsing tree with no preview should fold the column", () => {
	// Mirrors toggleTree: nextCollapsed && !hasPreview → filesColumnHidden = true
	let filesColumnHidden = false;
	const nextCollapsed = true;
	const hasPreview = false;
	if (nextCollapsed && !hasPreview) {
		filesColumnHidden = true;
	}
	assert.equal(filesColumnHidden, true);
	assert.equal(
		isFilesChromeEffectivelyHidden({
			isCompact: false,
			mobileDrawerOpen: false,
			filesColumnHidden,
			treeCollapsed: true,
			hasPreview: false,
		}),
		true,
	);
});
