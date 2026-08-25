import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
	syncGrantedAppScopes,
	clearGrantedAppScopes,
	hasGrantedAppScopes,
	listGrantedAppScopes,
	setGrantedAppScopes,
} from "../src/app-grant-cache.js";

const originalLocalStorage = globalThis.localStorage;

function storageMock(store: Record<string, string>): Storage {
	return {
		get length() {
			return Object.keys(store).length;
		},
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		key: (index: number) => Object.keys(store)[index] ?? null,
		clear: () => {
			for (const key of Object.keys(store)) delete store[key];
		},
	} as Storage;
}

afterEach(() => {
	globalThis.localStorage = originalLocalStorage;
});

test("setGrantedAppScopes replaces scopes instead of merging", () => {
	const store: Record<string, string> = {};
	globalThis.localStorage = storageMock(store);

	setGrantedAppScopes("user-1", "app-1", ["file.view", "session.view"]);
	setGrantedAppScopes("user-1", "app-1", ["file.view"]);

	// An explicit consent with fewer scopes must narrow the cache, or silent
	// reuse could hand back permissions the viewer just removed.
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["file.view"]), true);
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["file.view", "session.view"]), false);

	// A full-access grant covers a later read-only request silently.
	setGrantedAppScopes("user-1", "app-1", ["session.prompt.fullaccess"]);
	assert.equal(
		hasGrantedAppScopes("user-1", "app-1", ["session.prompt.readonly"]),
		true,
	);
	setGrantedAppScopes("user-1", "app-1", ["file.view"]);
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["file.view.filtered"]), true);
	// Not the other way around.
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["session.prompt.fullaccess"]), false);
	setGrantedAppScopes("user-1", "app-1", ["file.view"]);

	// Per-space entries stay independent of the home-space entry.
	setGrantedAppScopes("user-1", "app-1", ["taskrun.view"], "space-b");
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["file.view"]), true);
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["taskrun.view"], "space-b"), true);
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["taskrun.view"]), false);
});

test("listGrantedAppScopes maps the home entry and per-space entries", () => {
	const now = Date.now();
	const store: Record<string, string> = {
		"cohub:work-grants:user-1:app-1:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["file.view"],
			updatedAt: now,
		}),
		"cohub:work-grants:user-1:app-1:space-b:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["taskrun.view"],
			updatedAt: now,
		}),
		"cohub:work-grants:user-1:app-1:space-c:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["stale"],
			updatedAt: now - 15 * 24 * 60 * 60 * 1000, // past the re-consent window
		}),
	};
	globalThis.localStorage = storageMock(store);

	assert.deepEqual(listGrantedAppScopes("user-1", "app-1", "home-space"), [
		{ spaceId: "home-space", scopes: ["file.view"] },
		{ spaceId: "space-b", scopes: ["taskrun.view"] },
	]);

	// Without the home space id the legacy entry has nothing to map to.
	assert.deepEqual(listGrantedAppScopes("user-1", "app-1"), [
		{ spaceId: "space-b", scopes: ["taskrun.view"] },
	]);
});

test("syncGrantedAppScopes moves a legacy entry and replaces scopes without renewing it", () => {
	const updatedAt = Date.now() - 123_456;
	const store: Record<string, string> = {
		"cohub:work-grants:user-1:app-1:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["file.view"],
			updatedAt,
		}),
	};
	globalThis.localStorage = storageMock(store);

	syncGrantedAppScopes("user-1", "app-1", undefined, "home-space", ["session.view"]);

	assert.equal(store["cohub:work-grants:user-1:app-1:v1"], undefined);
	assert.deepEqual(
		JSON.parse(store["cohub:work-grants:user-1:app-1:home-space:v1"] ?? "null"),
		{
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["session.view"],
			updatedAt,
		},
	);
});

test("syncGrantedAppScopes keeps canonical age and replaces its scopes", () => {
	const legacyUpdatedAt = Date.now() - 2_000;
	const canonicalUpdatedAt = Date.now() - 1_000;
	const store: Record<string, string> = {
		"cohub:work-grants:user-1:app-1:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["file.view"],
			updatedAt: legacyUpdatedAt,
		}),
		"cohub:work-grants:user-1:app-1:home-space:v1": JSON.stringify({
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["session.view"],
			updatedAt: canonicalUpdatedAt,
		}),
	};
	globalThis.localStorage = storageMock(store);

	syncGrantedAppScopes("user-1", "app-1", undefined, "home-space", ["taskrun.view"]);

	assert.equal(store["cohub:work-grants:user-1:app-1:v1"], undefined);
	assert.deepEqual(
		JSON.parse(store["cohub:work-grants:user-1:app-1:home-space:v1"] ?? "null"),
		{
			version: 1,
			userUuid: "user-1",
			appId: "app-1",
			scopes: ["taskrun.view"],
			updatedAt: canonicalUpdatedAt,
		},
	);
});

test("clearGrantedAppScopes removes one space without touching others", () => {
	const store: Record<string, string> = {};
	globalThis.localStorage = storageMock(store);

	setGrantedAppScopes("user-1", "app-1", ["file.view"]);
	setGrantedAppScopes("user-1", "app-1", ["taskrun.view"], "space-b");

	clearGrantedAppScopes("user-1", "app-1", "space-b");
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["file.view"]), true);
	assert.equal(hasGrantedAppScopes("user-1", "app-1", ["taskrun.view"], "space-b"), false);
});
