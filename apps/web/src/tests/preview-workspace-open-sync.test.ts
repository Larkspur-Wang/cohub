import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Pure timing rules for preview open ↔ URL sync.
 * Mirrors createPreviewWorkspaceController.openFile / route hydrate teardown.
 *
 * Bug: openFile awaited domain I/O before syncUrl, so route hydration could see
 * a brief no-preview URL while UI already opened a file and call closeAll.
 */

type PreviewRef = { kind: "file" | "canvas" | "port"; key: string } | null;

test("sync-after-await can close preview while open is in flight", () => {
	// Drive the old path carefully with explicit steps (no races in the harness).
	let uiRef: PreviewRef = null;
	let urlRef: PreviewRef = null;
	let closedDuringOpen = false;

	// 1) User open: set UI kind, await I/O later
	uiRef = { kind: "file", key: "a.md" };
	// 2) Route effect: no ?preview= yet
	if (!urlRef && uiRef) {
		// old teardown
		uiRef = null;
		closedDuringOpen = true;
	}
	// 3) openFile finally syncs URL (too late)
	urlRef = { kind: "file", key: "a.md" };

	assert.equal(closedDuringOpen, true);
	assert.equal(uiRef, null);
	assert.deepEqual(urlRef, { kind: "file", key: "a.md" });
});

test("sync-before-await keeps preview open through route effect", () => {
	let uiRef: PreviewRef = null;
	let urlRef: PreviewRef = null;
	let closedDuringOpen = false;

	// 1) Early URL sync (new openFile)
	urlRef = { kind: "file", key: "a.md" };
	// 2) Domain activates UI
	uiRef = { kind: "file", key: "a.md" };
	// 3) Route effect: URL already has preview → no teardown
	if (!urlRef && uiRef) {
		uiRef = null;
		closedDuringOpen = true;
	}

	assert.equal(closedDuringOpen, false);
	assert.deepEqual(uiRef, { kind: "file", key: "a.md" });
	assert.deepEqual(urlRef, { kind: "file", key: "a.md" });
});

test("route effect restores URL when UI still has preview", () => {
	// New defensive branch: !routePreview but currentRef() → re-sync, not closeAll.
	const uiRef: PreviewRef = { kind: "file", key: "a.md" };
	const routePreview: PreviewRef = null;
	let urlRef: PreviewRef = null;
	let closed = false;

	if (!routePreview) {
		if (uiRef) {
			urlRef = uiRef; // restore
		} else {
			closed = true;
		}
	}

	assert.equal(closed, false);
	assert.deepEqual(urlRef, { kind: "file", key: "a.md" });
});

test("first open pushes history; later open replaces", () => {
	// hadPreview = Boolean(currentRef()) BEFORE setting activeKind.
	let current: PreviewRef = null;
	const historyMode: Array<"push" | "replace"> = [];

	const open = (path: string) => {
		const hadPreview = Boolean(current);
		current = { kind: "file", key: path };
		historyMode.push(hadPreview ? "replace" : "push");
	};

	open("a.md");
	open("b.md");
	assert.deepEqual(historyMode, ["push", "replace"]);
});
