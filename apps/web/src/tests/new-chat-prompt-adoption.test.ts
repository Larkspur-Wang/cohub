import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import type { SessionRecord } from "@neta-art/cohub";
import { adoptPromptSessionState } from "../lib/features/session-chat/session-utils.ts";
import type { SessionViewState } from "../lib/features/session-chat/session-workspace-controller.svelte.ts";

const session = { id: "session-1" } as SessionRecord;
const acceptedTurn = {
	id: "turn-1",
	sessionId: session.id,
	sequence: 1,
	status: "running",
	meta: { clientMessageId: "message-1" },
} as unknown as SessionTurnRecord;

function realtimeSeed(turns: SessionTurnRecord[]): SessionViewState {
	return {
		session,
		turns,
		loading: false,
		loaded: false,
		error: null,
		hasMore: true,
		hasMoreNewer: false,
		loadingOlder: false,
		loadingNewer: false,
		oldestCursor: undefined,
	};
}

test("prompt adoption completes a session seeded by session.created", () => {
	const result = adoptPromptSessionState({
		existing: realtimeSeed([]),
		session,
		turn: acceptedTurn,
	});

	assert.equal(result.loaded, true);
	assert.equal(result.loading, false);
	assert.equal(result.hasMore, false);
	assert.deepEqual(result.turns, [acceptedTurn]);
});

test("prompt adoption deduplicates a turn received through realtime first", () => {
	const result = adoptPromptSessionState({
		existing: realtimeSeed([acceptedTurn]),
		session,
		turn: acceptedTurn,
	});

	assert.equal(result.loaded, true);
	assert.equal(result.turns.length, 1);
	assert.equal(result.turns[0]?.id, acceptedTurn.id);
});
