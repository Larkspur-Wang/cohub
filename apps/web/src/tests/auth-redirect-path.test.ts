import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	AUTH_JUST_COMPLETED_KEY,
	clearAuthJustCompleted,
	hasRecentAuthCompletion,
	markAuthJustCompleted,
	sanitizeRedirectPath,
} from "../lib/auth.ts";

const memoryStore = () => {
	const map = new Map<string, string>();
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, String(value));
		},
		removeItem: (key: string) => {
			map.delete(key);
		},
		clear: () => {
			map.clear();
		},
	};
};

const session = memoryStore();
(
	globalThis as { sessionStorage?: ReturnType<typeof memoryStore> }
).sessionStorage = session;

afterEach(() => {
	session.clear();
});

test("sanitizeRedirectPath keeps relative destinations and hash", () => {
	assert.equal(sanitizeRedirectPath("/spaces/new"), "/spaces/new");
	assert.equal(
		sanitizeRedirectPath("/spaces/s1?tab=files#panel"),
		"/spaces/s1?tab=files#panel",
	);
	assert.equal(sanitizeRedirectPath("/"), "/");
	assert.equal(sanitizeRedirectPath(""), "/");
	assert.equal(sanitizeRedirectPath(null), "/");
	assert.equal(sanitizeRedirectPath(undefined), "/");
});

test("sanitizeRedirectPath blocks auth endpoints and open redirects", () => {
	assert.equal(sanitizeRedirectPath("/callback"), "/");
	assert.equal(sanitizeRedirectPath("/callback?code=x"), "/");
	assert.equal(sanitizeRedirectPath("/callback/extra"), "/");
	assert.equal(sanitizeRedirectPath("/app-auth"), "/");
	assert.equal(sanitizeRedirectPath("/app-auth?next=1"), "/");
	assert.equal(sanitizeRedirectPath("//evil.example/phish"), "/");
	assert.equal(sanitizeRedirectPath("https://evil.example/phish"), "/");
	assert.equal(sanitizeRedirectPath("https://evil.example"), "/");
	assert.equal(sanitizeRedirectPath("/spaces/x\\@evil"), "/");
	assert.equal(sanitizeRedirectPath("not-a-path"), "/");
});

test("hasRecentAuthCompletion respects TTL and clear", () => {
	assert.equal(hasRecentAuthCompletion(), false);

	markAuthJustCompleted();
	assert.equal(hasRecentAuthCompletion(), true);
	assert.equal(hasRecentAuthCompletion(60_000), true);

	// Stale marker
	session.setItem(AUTH_JUST_COMPLETED_KEY, String(Date.now() - 60_000));
	assert.equal(hasRecentAuthCompletion(30_000), false);

	markAuthJustCompleted();
	clearAuthJustCompleted();
	assert.equal(hasRecentAuthCompletion(), false);
});
