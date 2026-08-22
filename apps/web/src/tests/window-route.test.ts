import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildFileIngressMainRoute,
	encodeWindowParam,
	isValidAppKey,
	isValidPortKey,
	parseWindowParam,
	readWindowFromSearch,
	resolveRouteWindow,
	withCurrentWindow,
	withSidebarMainWindow,
	withWindowParam,
} from "../lib/features/space/modules/window-route.ts";

test("parseWindowParam accepts file/board/port", () => {
	assert.deepEqual(parseWindowParam("file:docs/a.md"), {
		kind: "file",
		key: "docs/a.md",
	});
	assert.deepEqual(parseWindowParam("port:5173"), {
		kind: "port",
		key: "5173",
	});
	assert.equal(parseWindowParam("unknown:x"), null);
	assert.equal(parseWindowParam("file:"), null);
});

test("parseWindowParam accepts app windows keyed by app id (legacy work spelling included)", () => {
	const appId = "123e4567-e89b-42d3-a456-426614174000";
	assert.deepEqual(parseWindowParam(`app:${appId}`), {
		kind: "app",
		key: appId,
	});
	assert.deepEqual(parseWindowParam(`work:${appId}`), {
		kind: "app",
		key: appId,
	});
	// The stable key is always an id, so slugs and URLs must not deep-link.
	assert.equal(parseWindowParam("work:alice/studio/launch"), null);
	assert.equal(parseWindowParam("work:not-an-id"), null);
	assert.equal(isValidAppKey(appId), true);
	assert.equal(isValidAppKey("launch"), false);
});

test("parseWindowParam rejects host-injection port keys", () => {
	assert.equal(parseWindowParam("port:80@evil.example"), null);
	assert.equal(parseWindowParam("port:abc"), null);
	assert.equal(parseWindowParam("port:0"), null);
	assert.equal(parseWindowParam("port:99999"), null);
	assert.equal(isValidPortKey("5173"), true);
	assert.equal(isValidPortKey("80@evil"), false);
});

test("withWindowParam sets and clears the window without dropping other params", () => {
	const withPreview = withWindowParam("/spaces/s1/sessions/abc", "turn=3", {
		kind: "file",
		key: "a.md",
	});
	assert.equal(
		withPreview,
		`/spaces/s1/sessions/abc?turn=3&window=${encodeURIComponent("file:a.md")}`,
	);
	assert.equal(
		withWindowParam(
			"/spaces/s1/sessions/abc",
			"turn=3&window=file%3Aa.md",
			null,
		),
		"/spaces/s1/sessions/abc?turn=3",
	);
});

test("readWindowFromSearch reads query", () => {
	assert.deepEqual(readWindowFromSearch("?window=file:readme.md"), {
		kind: "file",
		key: "readme.md",
	});
	assert.deepEqual(
		readWindowFromSearch(new URLSearchParams("window=board:board.board")),
		{ kind: "board", key: "board.board" },
	);
});

test("an explicit window URL wins over stale shallow route state", () => {
	const appId = "123e4567-e89b-42d3-a456-426614174000";
	assert.deepEqual(resolveRouteWindow(`?window=work:${appId}`, null), {
		kind: "app",
		key: appId,
	});
	assert.deepEqual(resolveRouteWindow("?turn=3", "file:readme.md"), {
		kind: "file",
		key: "readme.md",
	});
});

test("legacy file ingress lands on new chat + file window", () => {
	assert.equal(
		buildFileIngressMainRoute("space-1", "docs/a.md"),
		`/spaces/space-1/sessions/new?window=${encodeURIComponent("file:docs/a.md")}`,
	);
	assert.equal(encodeWindowParam({ kind: "file", key: "x" }), "file:x");
});

test("closing the last window only drops the window param", () => {
	const main = "/spaces/s/sessions/sess-1";
	const open = withWindowParam(main, "turn=2", {
		kind: "file",
		key: "a.md",
	});
	const closed = withWindowParam(main, new URL(open, "https://x").search, null);
	assert.equal(closed, `${main}?turn=2`);
});

test("withCurrentWindow preserves the active window across main route changes", () => {
	const next = withCurrentWindow(
		"/spaces/s1/sessions/new",
		"window=file%3Adocs%2Fa.md&turn=2",
	);
	assert.equal(
		next,
		`/spaces/s1/sessions/new?window=${encodeURIComponent("file:docs/a.md")}`,
	);
	assert.equal(
		withCurrentWindow("/spaces/s1/sessions/abc", ""),
		"/spaces/s1/sessions/abc",
	);
});

test("new chat -> session keeps the window (send must not collapse Files)", () => {
	// Repro: open a file window on /sessions/new, send first message, router.toSession
	// must preserve ?window= so layout does not drop the window pane.
	const afterSend = withCurrentWindow(
		"/spaces/s1/sessions/sess-created",
		`window=${encodeURIComponent("file:docs/a.md")}`,
	);
	assert.equal(
		afterSend,
		`/spaces/s1/sessions/sess-created?window=${encodeURIComponent("file:docs/a.md")}`,
	);
});

test("sidebar main navigation drops the window on mobile, keeps it on desktop", () => {
	const pathname = "/spaces/s1/sessions/sess-2";
	const search = `window=${encodeURIComponent("board:boards/main.board")}`;
	assert.equal(
		withSidebarMainWindow(pathname, { isMobile: true, currentSearch: search }),
		pathname,
	);
	assert.equal(
		withSidebarMainWindow(pathname, {
			isMobile: false,
			currentSearch: search,
		}),
		`${pathname}?window=${encodeURIComponent("board:boards/main.board")}`,
	);
});

test("turn navigation can keep preview alongside turn param", () => {
	const withTurn = withWindowParam(
		"/spaces/s1/sessions/sess-1",
		new URLSearchParams({ turn: "3" }),
		{ kind: "file", key: "docs/a.md" },
	);
	assert.equal(
		withTurn,
		`/spaces/s1/sessions/sess-1?turn=3&window=${encodeURIComponent("file:docs/a.md")}`,
	);
});
