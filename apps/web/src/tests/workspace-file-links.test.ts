import assert from "node:assert/strict";
import { test } from "node:test";
import {
	normalizeWorkspaceFileLink,
	normalizeWorkspaceFileLinkTarget,
} from "../lib/workspace-file-links";

test("normalizeWorkspaceFileLink converts workspace absolute links", () => {
	assert.equal(normalizeWorkspaceFileLink("/workspace/file.md"), "file.md");
	assert.equal(
		normalizeWorkspaceFileLink("/workspace/apps/web/src/lib/a%20b.md"),
		"apps/web/src/lib/a b.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("workspace/docs/readme.md"),
		"docs/readme.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink(
			"/workspace/cohub/apps/web/src/lib/features/space/SpaceWorkspacePage.svelte:1778",
		),
		"cohub/apps/web/src/lib/features/space/SpaceWorkspacePage.svelte",
	);
});

test("normalizeWorkspaceFileLink keeps workspace-relative links", () => {
	assert.equal(normalizeWorkspaceFileLink("docs/readme.md"), "docs/readme.md");
	assert.equal(normalizeWorkspaceFileLink("./readme.md"), "readme.md");
	assert.equal(
		normalizeWorkspaceFileLink("docs/readme.md#intro"),
		"docs/readme.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("docs/readme.md?raw=1"),
		"docs/readme.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("apps/web/src/lib/foo.ts:12:5"),
		"apps/web/src/lib/foo.ts",
	);
});

test("normalizeWorkspaceFileLink resolves relative links from a markdown file", () => {
	assert.equal(
		normalizeWorkspaceFileLink("./guide.md", {
			basePath: "docs/reference/index.md",
		}),
		"docs/reference/guide.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("../README.md", {
			basePath: "docs/reference/index.md",
		}),
		"docs/README.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("README.md", {
			basePath: "docs/reference/index.md",
		}),
		"docs/reference/README.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("assets/logo.png", {
			basePath: "docs/reference/index.md",
		}),
		"docs/reference/assets/logo.png",
	);
});

test("normalizeWorkspaceFileLinkTarget preserves optional line positions", () => {
	assert.deepEqual(
		normalizeWorkspaceFileLinkTarget(
			"/workspace/cohub/apps/web/src/lib/features/space/SpaceWorkspacePage.svelte:1778",
		),
		{
			path: "cohub/apps/web/src/lib/features/space/SpaceWorkspacePage.svelte",
			position: { line: 1778 },
		},
	);
	assert.deepEqual(
		normalizeWorkspaceFileLinkTarget("apps/web/src/lib/foo.ts:12:5"),
		{
			path: "apps/web/src/lib/foo.ts",
			position: { line: 12, column: 5 },
		},
	);
});

test("normalizeWorkspaceFileLink rejects external and unsafe links", () => {
	assert.equal(normalizeWorkspaceFileLink("https://example.com/a.md"), null);
	assert.equal(normalizeWorkspaceFileLink("http://example.com/a.md"), null);
	assert.equal(normalizeWorkspaceFileLink("//example.com/a.md"), null);
	assert.equal(normalizeWorkspaceFileLink("mailto:hello@example.com"), null);
	assert.equal(normalizeWorkspaceFileLink("#intro"), null);
	assert.equal(normalizeWorkspaceFileLink("/spaces/space-id/files/a.md"), null);
	assert.equal(normalizeWorkspaceFileLink("../../secret.md"), null);
	assert.equal(normalizeWorkspaceFileLink("/workspace/../secret.md"), null);
	assert.equal(normalizeWorkspaceFileLink("docs\\readme.md"), null);
});
