import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Pure path matchers for mobile session nav transitions.
 * Inlined here so node:test does not need SvelteKit $lib resolution.
 * Keep in sync with `$lib/navigation-transition`.
 */

function isSessionsListPath(pathname: string): boolean {
	return pathname === "/sessions" || pathname === "/sessions/";
}

function isSpaceSessionDetailPath(pathname: string): boolean {
	const match = pathname.match(/^\/spaces\/[^/]+\/sessions\/([^/]+)\/?$/);
	if (!match) return false;
	return match[1] !== "new";
}

function matchMobileSessionNavTransition(
	fromPath: string,
	toPath: string,
): "session-forward" | "session-back" | null {
	if (isSessionsListPath(fromPath) && isSpaceSessionDetailPath(toPath)) {
		return "session-forward";
	}
	if (isSpaceSessionDetailPath(fromPath) && isSessionsListPath(toPath)) {
		return "session-back";
	}
	return null;
}

test("isSessionsListPath matches /sessions only", () => {
	assert.equal(isSessionsListPath("/sessions"), true);
	assert.equal(isSessionsListPath("/sessions/"), true);
	assert.equal(isSessionsListPath("/sessions/abc"), false);
	assert.equal(isSessionsListPath("/spaces/x/sessions/y"), false);
});

test("isSpaceSessionDetailPath ignores new landing", () => {
	assert.equal(isSpaceSessionDetailPath("/spaces/s1/sessions/abc"), true);
	assert.equal(isSpaceSessionDetailPath("/spaces/s1/sessions/new"), false);
	assert.equal(isSpaceSessionDetailPath("/sessions/abc"), false);
});

test("matchMobileSessionNavTransition forward and back", () => {
	assert.equal(
		matchMobileSessionNavTransition("/sessions", "/spaces/s1/sessions/abc"),
		"session-forward",
	);
	assert.equal(
		matchMobileSessionNavTransition("/spaces/s1/sessions/abc", "/sessions"),
		"session-back",
	);
	assert.equal(
		matchMobileSessionNavTransition("/sessions", "/spaces/s1/sessions/new"),
		null,
	);
	assert.equal(
		matchMobileSessionNavTransition("/sessions/abc", "/spaces/s1/sessions/abc"),
		null,
	);
	assert.equal(
		matchMobileSessionNavTransition("/home", "/spaces/s1/sessions/abc"),
		null,
	);
});
