import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
	new URL("../lib/components/app/AppSurface.svelte", import.meta.url),
	"utf8",
);
const previewSource = readFileSync(
	new URL("../lib/features/space/modules/AppWindow.svelte", import.meta.url),
	"utf8",
);
const backgroundSource = readFileSync(
	new URL("../lib/components/NewChatBackground.svelte", import.meta.url),
	"utf8",
);
const workBackgroundSource = readFileSync(
	new URL("../lib/components/NewChatAppBackground.svelte", import.meta.url),
	"utf8",
);
const sessionPanelSource = readFileSync(
	new URL(
		"../lib/features/session-chat/SessionChatPanel.svelte",
		import.meta.url,
	),
	"utf8",
);
const workspaceSource = readFileSync(
	new URL("../lib/features/space/SpaceWorkspacePage.svelte", import.meta.url),
	"utf8",
);

test("composer context alone enables the Work Surface message host", () => {
	assert.match(
		source,
		/onSurfaceHost \|\| onComposerChip\s*\? createAppSurfaceHost/,
	);
});

test("runtime context waits for the embedded document handshake", () => {
	assert.match(source, /let runtimeReady = \$state\(false\)/);
	assert.match(source, /if \(!runtimeReady \|\| !frameOrigin\) return/);
	assert.match(source, /parseAppRuntimeReady\(event\.data\)/);
	assert.match(
		source,
		/runtimeReady = false;\s+surfaceHost\?\.reset\(\);\s+reportReady\(\);/,
	);
});

test("all Work frames delegate low-risk user-activated capabilities", () => {
	assert.match(
		source,
		/const framePermissions\s*=\s*"clipboard-read; clipboard-write; fullscreen; web-share"/,
	);
	assert.match(source, /<iframe[\s\S]*?allow=\{framePermissions\}/);
});

test("background Work frames still exclude pointer lock", () => {
	assert.match(
		source,
		/allow-modals\$\{isBackground \? "" : " allow-pointer-lock"\}/,
	);
});

test("a reopened Work preview remounts its surface lifecycle", () => {
	assert.match(previewSource, /\{#key preview\.mountKey\}/);
});

test("Work authorization receives the mounted surface mode", () => {
	assert.match(source, /authorizationContext: \{ surface: mode \}/);
});

test("Work previews pass invocation context through the runtime bridge", () => {
	assert.match(
		previewSource,
		/invocation=\{preview\.invocation \?\? undefined\}/,
	);
	assert.match(source, /createAppBridgeHost\(\{[\s\S]*?invocation,/);
	assert.match(
		workspaceSource,
		/invocation: AppRuntimeInvocationContext[\s\S]*?sessionId: context\.source\.sessionId/,
	);
});

test("New Chat App receives the hosting Space invocation context", () => {
	assert.match(workBackgroundSource, /currentSpaceId\?: string \| null/);
	assert.match(
		workBackgroundSource,
		/invocation=\{currentSpaceId[\s\S]*?surface: "background", source: "route", spaceId: currentSpaceId/,
	);
	assert.match(backgroundSource, /currentSpaceId=\{spaceId\}/);
});

test("New Chat Work composer context reaches the workspace coordinator", () => {
	assert.match(workBackgroundSource, /onComposerChip=\{\(chip\) =>/);
	assert.match(backgroundSource, /onComposerChip=\{onAppComposerChip\}/);
	assert.match(
		sessionPanelSource,
		/onAppComposerChip=\{onNewChatBackgroundComposerChip\}/,
	);
	assert.match(
		workspaceSource,
		/onNewChatBackgroundComposerChip=\{handleNewChatBackgroundComposerChip\}/,
	);
});

test("active previews take priority over background Work context", () => {
	assert.match(
		workspaceSource,
		/if \(activeWindowKind\) \{[\s\S]{0,160}?reportActiveSource\(null\);[\s\S]{0,100}?if \(newChatBackgroundWorkContext\)/,
	);
	assert.match(
		workspaceSource,
		/if \(!shouldShowNewChatBackground\) newChatBackgroundWorkContext = null/,
	);
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
