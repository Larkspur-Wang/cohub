import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
	new URL("../lib/components/work/WorkSurface.svelte", import.meta.url),
	"utf8",
);
const previewSource = readFileSync(
	new URL(
		"../lib/features/space/modules/WorkPreviewPanel.svelte",
		import.meta.url,
	),
	"utf8",
);

test("composer context alone enables the Work Surface message host", () => {
	assert.match(
		source,
		/onSurfaceHost \|\| onComposerChip\s*\? createWorkSurfaceHost/,
	);
});

test("interactive Work frames delegate low-risk user-activated capabilities", () => {
	assert.match(
		source,
		/isBackground \? undefined : "clipboard-write; fullscreen; web-share"/,
	);
	assert.match(source, /<iframe[\s\S]*?allow=\{framePermissions\}/);
});

test("a reopened Work preview remounts its surface lifecycle", () => {
	assert.match(previewSource, /\{#key preview\.mountKey\}/);
});

test("unregistering a surface never reads the preview it is leaving", () => {
	// The surface reports `null` from its unmount cleanup, which runs while the
	// panel is being destroyed and `preview` is already gone. Reading the prop in
	// that callback faults and aborts the teardown, so the next open finds a
	// half-destroyed tree and paints an empty stage.
	assert.match(previewSource, /onSurfaceHost=\{handleSurfaceHost\}/);
	assert.match(previewSource, /onComposerChip=\{handleComposerChip\}/);
	assert.doesNotMatch(previewSource, /onSurfaceHost=\{\(host\) =>/);
	assert.doesNotMatch(previewSource, /onComposerChip=\{\(chip\) =>/);
	assert.match(previewSource, /let surfaceWorkId: string \| null = null/);
	assert.match(
		previewSource,
		/function handleSurfaceHost\([\s\S]{0,200}?onRegisterSurface\(surfaceWorkId, host\)/,
	);
});

test("a surface releases its bridge even if the consumer's unregister throws", () => {
	// Otherwise one faulty listener leaks the frame's message bridge.
	assert.match(
		source,
		/try \{\s*onSurfaceHost\?\.\(null\);\s*\} finally \{\s*surfaceHost\?\.dispose\(\);\s*\}/,
	);
});
