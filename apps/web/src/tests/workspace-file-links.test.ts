import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWorkspaceFileLink } from "../lib/workspace-file-links";

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
