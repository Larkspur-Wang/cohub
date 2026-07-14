import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import {
	formatTurnNavPreview,
	formatTurnNavPreviewDisplay,
	getTurnNavAttachmentLabel,
	getTurnNavAuthorName,
	shouldShowTurnNavAuthors,
	TURN_NAV_PREVIEW_MAX_LENGTH,
	truncateTurnNavPreview,
	turnRecordToIndexItem,
} from "../lib/turn-nav-preview";

test("formatTurnNavPreview labels compact turns", () => {
	assert.equal(
		formatTurnNavPreview({
			intent: "compact",
			userPreview: null,
		}),
		"Context compacted",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "compact",
			userPreview: null,
		}),
		null,
	);
});

test("formatTurnNavPreview keeps normal text", () => {
	assert.equal(
		formatTurnNavPreview({
			intent: "followup",
			userPreview: "  Help me debug login  ",
		}),
		"Help me debug login",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "followup",
			userPreview: "  Help me debug login  ",
		}),
		null,
	);
});

test("display preview truncates long turn text", () => {
	const long = `Please help me carefully review this long message ${"x".repeat(200)}`;
	assert.equal(
		formatTurnNavPreview({
			intent: "followup",
			userPreview: long,
		}),
		long,
	);
	const display = formatTurnNavPreviewDisplay({
		intent: "followup",
		userPreview: long,
	});
	assert.ok(display.endsWith("…"));
	assert.equal(display.length, TURN_NAV_PREVIEW_MAX_LENGTH);
	assert.equal(truncateTurnNavPreview("short"), "short");
	assert.equal(truncateTurnNavPreview("abcdefghij", 6), "abcde…");
});

test("attachments stay out of body and live on meta label", () => {
	assert.equal(
		formatTurnNavPreview({
			intent: "steer",
			userPreview: "https://cdn.example.com/a.png",
		}),
		"",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "steer",
			userPreview: "https://cdn.example.com/a.png",
		}),
		"Image",
	);

	assert.equal(
		formatTurnNavPreview({
			intent: "steer",
			userPreview: "check this\nhttps://cdn.example.com/a.png",
		}),
		"check this",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "steer",
			userPreview: "check this\nhttps://cdn.example.com/a.png",
		}),
		"Image",
	);

	assert.equal(
		formatTurnNavPreview({
			intent: "steer",
			userPreview:
				"https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png",
		}),
		"",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "steer",
			userPreview:
				"https://cdn.example.com/a.png\nhttps://cdn.example.com/b.png",
		}),
		"2 images",
	);

	assert.equal(
		formatTurnNavPreview({
			intent: "steer",
			userPreview: "look · Image",
		}),
		"look",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "steer",
			userPreview: "look · Image",
		}),
		"Image",
	);
});

test("content blocks prefer body text and image count separately", () => {
	const turn = {
		intent: "steer" as const,
		userPreview: "https://cdn.example.com/a.png",
		userContent: [
			{ type: "text" as const, text: "look" },
			{
				type: "image" as const,
				source: { type: "url" as const, url: "https://cdn.example.com/a.png" },
			},
		],
	};
	assert.equal(formatTurnNavPreview(turn), "look");
	assert.equal(getTurnNavAttachmentLabel(turn), "Image");
});

test("formatTurnNavPreview falls back for empty messages", () => {
	assert.equal(
		formatTurnNavPreview({
			intent: "followup",
			userPreview: null,
		}),
		"Empty message",
	);
	assert.equal(
		getTurnNavAttachmentLabel({
			intent: "followup",
			userPreview: null,
		}),
		null,
	);
});

test("turnRecordToIndexItem includes intent, author, and image-aware preview", () => {
	const turn = {
		id: "turn-1",
		sessionId: "session-1",
		userUuid: "user-1",
		sequence: 3,
		status: "completed",
		intent: "compact",
		userContent: [],
		userText: null,
		assistantContent: [
			{ type: "system_note", note_type: "compacted", text: "summary" },
		],
		assistantText: null,
		provider: null,
		model: null,
		stopReason: null,
		errorMessage: null,
		finalUsage: null,
		totalUsage: null,
		summary: null,
		intermediateIndex: null,
		intermediateSummary: null,
		meta: null,
		authorProfile: {
			userUuid: "user-1",
			username: "alice",
			displayName: "Alice",
			avatarUrl: null,
		},
		startedAt: null,
		completedAt: null,
		durationMs: null,
		createdAt: "2026-07-13T01:02:03.000Z",
		updatedAt: "2026-07-13T01:02:03.000Z",
	} satisfies SessionTurnRecord;

	const item = turnRecordToIndexItem(turn);
	assert.equal(item.intent, "compact");
	assert.equal(item.userUuid, "user-1");
	assert.equal(item.authorProfile?.displayName, "Alice");
	assert.equal(formatTurnNavPreview(item), "Context compacted");
	assert.equal(getTurnNavAuthorName(item), "Alice");
});

test("shouldShowTurnNavAuthors only enables multi-author lists", () => {
	assert.equal(shouldShowTurnNavAuthors([{ userUuid: "a" }]), false);
	assert.equal(
		shouldShowTurnNavAuthors([{ userUuid: "a" }, { userUuid: "a" }]),
		false,
	);
	assert.equal(
		shouldShowTurnNavAuthors([
			{ userUuid: "a" },
			{ userUuid: null },
			{ userUuid: "b" },
		]),
		true,
	);
	assert.equal(shouldShowTurnNavAuthors([{ userUuid: null }]), false);
});
