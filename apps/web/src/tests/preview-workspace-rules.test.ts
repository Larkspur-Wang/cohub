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
		"CanvasPreviewPanel.svelte",
		"PortPreviewPanel.svelte",
	].map((file) => readFileSync(new URL(file, modules), "utf8"));

	assert.equal(domain.match(/<WorkspacePreviewPane\b/g)?.length, 1);
	for (const panel of panels) {
		assert.doesNotMatch(panel, /WorkspacePreviewPane/);
		assert.match(panel, /MobilePreviewTabsChrome/);
	}
	assert.doesNotMatch(panels[0], /lg:hidden fixed inset-0 z-50/);

	const mobileChrome = panels[0].slice(
		panels[0].indexOf("<MobilePreviewTabsChrome"),
		panels[0].indexOf("</MobilePreviewTabsChrome>") +
			"</MobilePreviewTabsChrome>".length,
	);
	assert.match(mobileChrome, /inlineFileCanGoBack/);
	assert.match(mobileChrome, /onBackInlineFile/);
});
