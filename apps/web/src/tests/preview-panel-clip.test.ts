import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Pure helpers mirrored from preview-panel-clip (node has no DOM).
 * Keep in sync with $lib/transitions/preview-panel-clip.
 */

function easePanelOut(t: number): number {
	return t === 0 || t === 1 ? t : 1 - (1 - t) ** 4;
}

test("easePanelOut endpoints and mid", () => {
	assert.equal(easePanelOut(0), 0);
	assert.equal(easePanelOut(1), 1);
	const mid = easePanelOut(0.5);
	assert.ok(mid > 0.5 && mid < 1);
});

test("width tween formula is linear in eased t", () => {
	const target = 480;
	const t = easePanelOut(0.5);
	const w = Math.max(0, target * t);
	assert.ok(w > 240 && w < 480);
});
