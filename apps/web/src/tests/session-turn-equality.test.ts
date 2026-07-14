import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import {
	areSessionTurnRecordsEqual,
	areSessionTurnsEqual,
	preserveSessionTurnRefs,
} from "../lib/session-turn-equality.ts";

function makeTurn(
	overrides: Partial<SessionTurnRecord> = {},
): SessionTurnRecord {
	return {
		id: "turn-1",
		sessionId: "session-1",
		userUuid: "user-1",
		sequence: 1,
		status: "completed",
		intent: "followup",
		userContent: [{ type: "text", text: "hi" }],
		userText: "hi",
		assistantContent: [{ type: "text", text: "hello" }],
		assistantText: "hello",
		provider: "cohub",
		model: "test",
		stopReason: "stop",
		errorMessage: null,
		finalUsage: null,
		totalUsage: null,
		summary: null,
		intermediateIndex: null,
		intermediateSummary: null,
		meta: null,
		startedAt: "2026-07-14T00:00:00.000Z",
		completedAt: "2026-07-14T00:00:01.000Z",
		durationMs: 1000,
		createdAt: "2026-07-14T00:00:00.000Z",
		updatedAt: "2026-07-14T00:00:01.000Z",
		...overrides,
	};
}

test("areSessionTurnRecordsEqual matches identical payloads", () => {
	const a = makeTurn();
	const b = makeTurn();
	assert.equal(areSessionTurnRecordsEqual(a, b), true);
});

test("areSessionTurnRecordsEqual detects scalar changes", () => {
	const a = makeTurn();
	const b = makeTurn({ status: "running" });
	assert.equal(areSessionTurnRecordsEqual(a, b), false);
});

test("areSessionTurnRecordsEqual detects nested content changes", () => {
	const a = makeTurn();
	const b = makeTurn({
		assistantContent: [{ type: "text", text: "changed" }],
		assistantText: "changed",
	});
	assert.equal(areSessionTurnRecordsEqual(a, b), false);
});

test("areSessionTurnRecordsEqual detects source and authorProfile changes", () => {
	const a = makeTurn({
		sourceSessionId: "src-session",
		sourceTurnId: "src-turn",
		authorProfile: {
			userUuid: "user-1",
			displayName: "Ada",
			avatarUrl: null,
			username: null,
		},
	});
	assert.equal(
		areSessionTurnRecordsEqual(
			a,
			makeTurn({
				sourceSessionId: "src-session",
				sourceTurnId: "other-turn",
				authorProfile: a.authorProfile,
			}),
		),
		false,
	);
	assert.equal(
		areSessionTurnRecordsEqual(
			a,
			makeTurn({
				sourceSessionId: "src-session",
				sourceTurnId: "src-turn",
				authorProfile: {
					userUuid: "user-1",
					displayName: "Bob",
					avatarUrl: null,
					username: null,
				},
			}),
		),
		false,
	);
});

test("preserveSessionTurnRefs reuses current object identity when equal", () => {
	const current = [makeTurn({ id: "a" }), makeTurn({ id: "b", sequence: 2 })];
	const next = [makeTurn({ id: "a" }), makeTurn({ id: "b", sequence: 2 })];
	const preserved = preserveSessionTurnRefs(current, next);
	assert.equal(preserved, current);
	assert.equal(preserved[0], current[0]);
	assert.equal(preserved[1], current[1]);
});

test("areSessionTurnsEqual is length-sensitive", () => {
	assert.equal(
		areSessionTurnsEqual(
			[makeTurn()],
			[makeTurn(), makeTurn({ id: "x", sequence: 2 })],
		),
		false,
	);
});
