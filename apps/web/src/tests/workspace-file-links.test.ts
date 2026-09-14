import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeWorkspaceFileLink,
	normalizeWorkspaceFileLinkTarget,
} from "$lib/workspace-file-links";

test("resolves workspace-prefixed paths", () => {
	assert.equal(normalizeWorkspaceFileLink("/workspace/a/b.md"), "a/b.md");
	assert.equal(normalizeWorkspaceFileLink("workspace/a/b.md"), "a/b.md");
	assert.equal(normalizeWorkspaceFileLink("/workspace/a/../b.md"), "b.md");
});

test("resolves relative paths against the workspace root without a base path", () => {
	// Chat markdown has no base file: relative references resolve from /workspace.
	assert.equal(normalizeWorkspaceFileLink("./a.md"), "a.md");
	assert.equal(normalizeWorkspaceFileLink("a/b.png"), "a/b.png");
	assert.equal(normalizeWorkspaceFileLink("../a.md"), null);
});

test("resolves relative paths against the current file directory", () => {
	const basePath = "docs/guides/note.md";
	assert.equal(
		normalizeWorkspaceFileLink("./a.md", { basePath }),
		"docs/guides/a.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("../a.md", { basePath }),
		"docs/a.md",
	);
	assert.equal(
		normalizeWorkspaceFileLink("/workspace/a.md", { basePath }),
		"a.md",
	);
});

test("keeps non-file targets out of workspace resolution", () => {
	for (const href of [
		"https://example.com/a.md",
		"https://example.com:8443/a.md",
		"mailto:team@example.com",
		"tel:1234567890",
		"cohub://spaces/abc",
		"data:text/plain,hi",
		"//cdn.example.com/a.png",
		"#section",
	]) {
		assert.equal(normalizeWorkspaceFileLink(href), null, href);
	}
	// Absolute site routes are not workspace files.
	for (const href of ["/spaces/abc", "/p/abc/a.png", "/other/x.md"]) {
		assert.equal(normalizeWorkspaceFileLink(href), null, href);
	}
});

test("strips query and hash but keeps line positions", () => {
	assert.equal(normalizeWorkspaceFileLink("a.md?raw"), "a.md");
	assert.equal(normalizeWorkspaceFileLink("a.md#L12"), "a.md");
	// A filename extension before `:line` must not be read as a URL scheme.
	assert.deepEqual(normalizeWorkspaceFileLinkTarget("a.md:12:3"), {
		path: "a.md",
		position: { line: 12, column: 3 },
	});
	assert.deepEqual(normalizeWorkspaceFileLinkTarget("src/a.ts:12"), {
		path: "src/a.ts",
		position: { line: 12 },
	});
});

test("decodes encoded references and rejects unsafe input", () => {
	assert.equal(normalizeWorkspaceFileLink("a%20b/c.png"), "a b/c.png");
	assert.equal(normalizeWorkspaceFileLink("a\\b.md"), null);
	assert.equal(normalizeWorkspaceFileLink(""), null);
	assert.equal(normalizeWorkspaceFileLink("/workspace"), null);
});
