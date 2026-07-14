import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpacePresenceUser } from "@neta-art/cohub";
import { arePresenceUsersEqual } from "../lib/features/space/modules/space-presence-equality.ts";

function makeUser(
	overrides: Partial<SpacePresenceUser> = {},
): SpacePresenceUser {
	return {
		userId: "user-1",
		connectionCount: 1,
		lastSeenAt: "2026-07-14T00:00:00.000Z",
		meta: null,
		metas: [],
		profile: {
			userUuid: "user-1",
			displayName: "Ada",
			avatarUrl: null,
			username: null,
		},
		...overrides,
	};
}

test("arePresenceUsersEqual matches identical users", () => {
	assert.equal(arePresenceUsersEqual([makeUser()], [makeUser()]), true);
});

test("arePresenceUsersEqual detects profile changes when meta is null", () => {
	const current = [makeUser()];
	const next = [
		makeUser({
			profile: {
				userUuid: "user-1",
				displayName: "Bob",
				avatarUrl: null,
				username: null,
			},
		}),
	];
	assert.equal(arePresenceUsersEqual(current, next), false);
});

test("arePresenceUsersEqual detects metas changes when meta is null", () => {
	const current = [makeUser({ meta: null, metas: [] })];
	const next = [
		makeUser({ meta: null, metas: [{ panels: [{ kind: "session" }] }] }),
	];
	assert.equal(arePresenceUsersEqual(current, next), false);
});

test("arePresenceUsersEqual detects meta changes", () => {
	const current = [makeUser({ meta: { panels: [{ kind: "session" }] } })];
	const next = [makeUser({ meta: { panels: [{ kind: "files" }] } })];
	assert.equal(arePresenceUsersEqual(current, next), false);
});
