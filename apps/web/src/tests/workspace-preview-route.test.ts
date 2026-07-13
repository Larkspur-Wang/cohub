import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildFileIngressMainRoute,
	encodePreviewParam,
	isValidPortKey,
	parsePreviewParam,
	readPreviewFromSearch,
	withPreviewParam,
} from "../lib/features/space/modules/workspace-preview-route.ts";

test("parsePreviewParam accepts file/canvas/port", () => {
	assert.deepEqual(parsePreviewParam("file:docs/a.md"), {
		kind: "file",
		key: "docs/a.md",
	});
	assert.deepEqual(parsePreviewParam("port:5173"), {
		kind: "port",
		key: "5173",
	});
	assert.equal(parsePreviewParam("unknown:x"), null);
	assert.equal(parsePreviewParam("file:"), null);
});

test("parsePreviewParam rejects host-injection port keys", () => {
	assert.equal(parsePreviewParam("port:80@evil.example"), null);
	assert.equal(parsePreviewParam("port:abc"), null);
	assert.equal(parsePreviewParam("port:0"), null);
	assert.equal(parsePreviewParam("port:99999"), null);
	assert.equal(isValidPortKey("5173"), true);
	assert.equal(isValidPortKey("80@evil"), false);
});

test("withPreviewParam sets and clears preview without dropping other params", () => {
	const withPreview = withPreviewParam("/spaces/s1/sessions/abc", "turn=3", {
		kind: "file",
		key: "a.md",
	});
	assert.equal(
		withPreview,
		`/spaces/s1/sessions/abc?turn=3&preview=${encodeURIComponent("file:a.md")}`,
	);
	assert.equal(
		withPreviewParam(
			"/spaces/s1/sessions/abc",
			"turn=3&preview=file%3Aa.md",
			null,
		),
		"/spaces/s1/sessions/abc?turn=3",
	);
});

test("readPreviewFromSearch reads query", () => {
	assert.deepEqual(readPreviewFromSearch("?preview=file:readme.md"), {
		kind: "file",
		key: "readme.md",
	});
	assert.deepEqual(
		readPreviewFromSearch(new URLSearchParams("preview=canvas:board.covas")),
		{ kind: "canvas", key: "board.covas" },
	);
});

test("legacy file ingress lands on new chat + file preview", () => {
	assert.equal(
		buildFileIngressMainRoute("space-1", "docs/a.md"),
		`/spaces/space-1/sessions/new?preview=${encodeURIComponent("file:docs/a.md")}`,
	);
	assert.equal(encodePreviewParam({ kind: "file", key: "x" }), "file:x");
});

test("closing last preview only drops preview param", () => {
	const main = "/spaces/s/sessions/sess-1";
	const open = withPreviewParam(main, "turn=2", {
		kind: "file",
		key: "a.md",
	});
	const closed = withPreviewParam(
		main,
		new URL(open, "https://x").search,
		null,
	);
	assert.equal(closed, `${main}?turn=2`);
});
