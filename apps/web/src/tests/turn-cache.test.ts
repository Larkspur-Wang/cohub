import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import { mergeTurnsById } from "../lib/stores/turn-cache.ts";

function makeTurn(
	overrides: Partial<SessionTurnRecord> = {},
): SessionTurnRecord {
	return {
		id: "turn-1",
		sessionId: "session-1",
		userUuid: "user-1",
		sequence: 1,
		status: "queued",
		intent: "followup",
		userContent: [{ type: "text", text: "hello" }],
		userText: "hello",
		assistantContent: null,
		assistantText: null,
		provider: "cohub",
		model: "test",
		stopReason: null,
		errorMessage: null,
		finalUsage: null,
		totalUsage: null,
		summary: null,
		intermediateIndex: null,
		intermediateSummary: null,
		meta: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
		createdAt: "2026-08-16T00:00:00.000Z",
		updatedAt: "2026-08-16T00:00:00.000Z",
		...overrides,
	};
}

test("late created event cannot regress a finalized turn", () => {
	const completed = makeTurn({
		status: "completed",
		assistantContent: [{ type: "text", text: "done" }],
		assistantText: "done",
		completedAt: "2026-08-16T00:00:02.000Z",
		updatedAt: "2026-08-16T00:00:02.000Z",
	});
	const [merged] = mergeTurnsById([completed], [makeTurn()], {
		preferIncoming: true,
	});

	assert.equal(merged?.status, "completed");
	assert.equal(merged?.assistantText, "done");
});

test("newer abort-requested update replaces running state", () => {
	const running = makeTurn({
		status: "running",
		updatedAt: "2026-08-16T00:00:01.000Z",
	});
	const abortRequested = makeTurn({
		status: "abort_requested",
		updatedAt: "2026-08-16T00:00:02.000Z",
	});
	const [merged] = mergeTurnsById([running], [abortRequested], {
		preferIncoming: true,
	});

	assert.equal(merged?.status, "abort_requested");
});

test("duplicate created event enriches missing author identity", () => {
	const current = makeTurn({ userUuid: null, authorProfile: null });
	const incoming = makeTurn({
		authorProfile: {
			userUuid: "user-1",
			displayName: "Ada",
			avatarUrl: null,
			username: null,
		},
	});
	const [merged] = mergeTurnsById([current], [incoming], {
		preferIncoming: true,
	});

	assert.equal(merged?.userUuid, "user-1");
	assert.equal(merged?.authorProfile?.displayName, "Ada");
});
