import assert from "node:assert/strict";
import { test } from "node:test";
import {
	activePreviewFilePath,
	workspaceFilePreviewKind,
} from "../lib/features/space/modules/preview-tabs.ts";
import { resolvePreviewRouteSync } from "../lib/features/space/modules/workspace-preview-route.ts";

test("Back closes an active preview after the route query is removed", () => {
	assert.equal(
		resolvePreviewRouteSync(null, { kind: "file", key: "a.md" }),
		"close",
	);
});

test("route rehydrates a preview cleared by workspace reset", () => {
	assert.equal(
		resolvePreviewRouteSync({ kind: "file", key: "a.md" }, null),
		"hydrate",
	);
});

test("route switches a stale preview and ignores a matching one", () => {
	const route = { kind: "file" as const, key: "b.md" };
	assert.equal(
		resolvePreviewRouteSync(route, { kind: "file", key: "a.md" }),
		"hydrate",
	);
	assert.equal(resolvePreviewRouteSync(route, route), "none");
});

test("file-tree selection follows the active preview kind", () => {
	const filePath = "docs/readme.md";
	const boardPath = "boards/plan.board";

	assert.equal(activePreviewFilePath("file", filePath, boardPath), filePath);
	assert.equal(activePreviewFilePath("board", filePath, boardPath), boardPath);
	assert.equal(activePreviewFilePath("port", filePath, boardPath), "");
	assert.equal(activePreviewFilePath(null, filePath, boardPath), "");
});

test("workspace file links use the same Board routing as the file tree", () => {
	assert.equal(workspaceFilePreviewKind("docs/readme.md", false), "file");
	assert.equal(workspaceFilePreviewKind("boards/plan.board", false), "board");
	assert.equal(workspaceFilePreviewKind("boards/PLAN.BOARD", false), "board");
	assert.equal(workspaceFilePreviewKind("boards/plan.board", true), "file");
});
