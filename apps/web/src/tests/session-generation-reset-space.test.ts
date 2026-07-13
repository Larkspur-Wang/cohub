import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Mirrors SessionGenerationStore.resetSpace: only drop entries owned by spaceId.
 * Keeps other hosts/spaces intact (multi-host safety invariant).
 * See also space-generation-lease.test.ts for host refcount ownership.
 */
function resetSpaceEntries<T extends { spaceId?: string | null }>(
	bySessionId: Record<string, T>,
	spaceId: string | null | undefined,
): Record<string, T> {
	if (!spaceId) return bySessionId;
	const next: Record<string, T> = {};
	for (const [sessionId, state] of Object.entries(bySessionId)) {
		if (state.spaceId === spaceId) continue;
		next[sessionId] = state;
	}
	return next;
}

test("resetSpace only clears sessions for the given space", () => {
	const bySessionId = {
		"session-a": { spaceId: "space-a", turnId: "turn-a" },
		"session-b": { spaceId: "space-b", turnId: "turn-b" },
		"session-c": { spaceId: "space-a", turnId: "turn-c" },
	};

	const next = resetSpaceEntries(bySessionId, "space-a");

	assert.deepEqual(Object.keys(next).sort(), ["session-b"]);
	assert.equal(next["session-b"]?.turnId, "turn-b");
	assert.equal(next["session-a"], undefined);
	assert.equal(next["session-c"], undefined);
});

test("resetSpace no-ops on empty spaceId", () => {
	const bySessionId = {
		"session-a": { spaceId: "space-a", turnId: "turn-a" },
	};
	assert.equal(resetSpaceEntries(bySessionId, null), bySessionId);
	assert.equal(resetSpaceEntries(bySessionId, undefined), bySessionId);
	assert.equal(resetSpaceEntries(bySessionId, ""), bySessionId);
});
