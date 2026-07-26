import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	isValidPortKey,
	parsePreviewParam,
	withPreviewParam,
} from "../lib/features/space/modules/workspace-preview-route.ts";

test("route back clearing preview is expressible as null ref", () => {
	const open = withPreviewParam("/spaces/s/sessions/a", null, {
		kind: "file",
		key: "a.md",
	});
	const closed = withPreviewParam(
		"/spaces/s/sessions/a",
		new URL(open, "https://x").search,
		null,
	);
	assert.equal(closed, "/spaces/s/sessions/a");
	assert.equal(parsePreviewParam(null), null);
});

test("port deep-link keys must be trusted numeric ports", () => {
	assert.equal(isValidPortKey("5173"), true);
	assert.equal(parsePreviewParam("port:80@evil"), null);
});

test("preview kinds share one workspace pane", () => {
	const modules = new URL("../lib/features/space/modules/", import.meta.url);
	const domain = readFileSync(
		new URL("SpaceFileDomain.svelte", modules),
		"utf8",
	);
	const panels = [
		"InlineFilePanel.svelte",
		"BoardPreviewPanel.svelte",
		"PortPreviewPanel.svelte",
	].map((file) => readFileSync(new URL(file, modules), "utf8"));
	const portPreview = readFileSync(
		new URL("../lib/components/PortPreview.svelte", import.meta.url),
		"utf8",
	);
	const codeEditor = readFileSync(
		new URL("../lib/components/CodeEditor.svelte", import.meta.url),
		"utf8",
	);
	const sharedMobileChrome = readFileSync(
		new URL("MobilePreviewTabsChrome.svelte", modules),
		"utf8",
	);

	assert.equal(domain.match(/<WorkspacePreviewPane\b/g)?.length, 1);
	assert.equal(domain.match(/<PreviewTabs\b/g)?.length, 1);
	for (const panel of panels) {
		assert.doesNotMatch(panel, /WorkspacePreviewPane/);
		assert.doesNotMatch(panel, /<PreviewTabs\b/);
		assert.doesNotMatch(panel, /PreviewExpandMenu/);
		assert.match(panel, /MobilePreviewTabsChrome/);
	}
	assert.match(panels[0], /PreviewFloatChrome/);
	assert.match(panels[1], /PreviewFloatChrome/);
	assert.match(portPreview, /PreviewFloatChrome/);
	assert.doesNotMatch(panels[0], /lg:hidden fixed inset-0 z-50/);

	const mobileChrome = panels[0].slice(
		panels[0].indexOf("<MobilePreviewTabsChrome"),
		panels[0].indexOf("</MobilePreviewTabsChrome>") +
			"</MobilePreviewTabsChrome>".length,
	);
	assert.match(mobileChrome, /inlineFileCanGoBack/);
	assert.match(mobileChrome, /onBackInlineFile/);
	assert.match(panels[0], /allowDrawerSwipe=\{isMobile\}/);
	assert.match(
		panels[1],
		/\{#await boardRuntimeModulePromise\}[\s\S]*\{@render LoadingPanel\(\)\}[\s\S]*\{:then boardRuntimeModule\}/,
		"board runtime import must retain loading chrome instead of exposing an empty full-screen pane",
	);
	assert.match(
		panels[1],
		/\{#key board\.boardId\}[\s\S]*<BoardRuntime/,
		"switching Board tabs must remount document-scoped runtime resources",
	);
	assert.match(
		codeEditor,
		/data-drawer-swipe-ignore=\{allowDrawerSwipe \? undefined : ""\}/,
	);
	assert.match(
		codeEditor,
		/class:cm-wrapper--drawer-swipe=\{allowDrawerSwipe\}/,
	);
	assert.match(portPreview, /data-drawer-swipe-ignore/);
	assert.match(sharedMobileChrome, /PanelRightOpen/);
	assert.doesNotMatch(sharedMobileChrome, /FolderOpen/);
});
