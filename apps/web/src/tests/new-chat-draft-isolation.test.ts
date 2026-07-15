import assert from "node:assert/strict";
import { test } from "node:test";
import {
	shouldClearActiveSessionForNewDraft,
	shouldClearResolvedNewSessionOnRoute,
} from "../lib/features/session-chat/new-chat-draft-isolation.ts";

test("entering /new from a session route clears prior adoption handoff", () => {
	assert.equal(
		shouldClearResolvedNewSessionOnRoute({
			nextKind: "new",
			prevKind: "session",
		}),
		true,
	);
	assert.equal(
		shouldClearResolvedNewSessionOnRoute({
			nextKind: "new",
			prevKind: "none",
		}),
		true,
	);
});

test("staying on /new after adopt keeps resolvedNewSessionId", () => {
	// adoptPromptSession sets resolvedNewSessionId while URL is still /new.
	// Re-sync must not wipe it or the mid-send timeline vanishes.
	assert.equal(
		shouldClearResolvedNewSessionOnRoute({
			nextKind: "new",
			prevKind: "new",
		}),
		false,
	);
});

test("session and none routes always clear resolvedNewSessionId", () => {
	assert.equal(
		shouldClearResolvedNewSessionOnRoute({
			nextKind: "session",
			prevKind: "new",
		}),
		true,
	);
	assert.equal(
		shouldClearResolvedNewSessionOnRoute({
			nextKind: "none",
			prevKind: "session",
		}),
		true,
	);
});

test("fresh draft clears active session so streaming content cannot pollute", () => {
	// After clearing resolvedNewSessionId on fresh draft entry, active must drop.
	assert.equal(
		shouldClearActiveSessionForNewDraft({
			resolvedNewSessionId: null,
			activeSessionId: "streaming-session",
		}),
		true,
	);
});

test("mid-send adopt keeps active session while resolvedNewSessionId is set", () => {
	assert.equal(
		shouldClearActiveSessionForNewDraft({
			resolvedNewSessionId: "just-created",
			activeSessionId: "just-created",
		}),
		false,
	);
});
