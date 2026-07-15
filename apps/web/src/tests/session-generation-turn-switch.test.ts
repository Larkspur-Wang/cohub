import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import { buildTurnTimelineItems } from "../lib/session-turn-render";

/**
 * Pure scenarios for queued follow-up turn handoff residual clearing.
 * Mirrors SessionGenerationStore markRuntimePhase / applyProgress / resumePending
 * turn-switch behavior without depending on IndexedDB persistence.
 */

type StreamingIntermediateMessage = {
	id?: string;
	messageId?: string | null;
	messageOrdinal?: number | null;
	content: ContentBlock[];
	text?: string | null;
};

type GenerationState = {
	status: string;
	contentBlocks: ContentBlock[];
	intermediateMessages: StreamingIntermediateMessage[];
	streamMessageId: string | null;
	messageOrdinal: number | null;
	anchorUserMessageId: string | null;
	truncatedStart: boolean;
	patchSeq: number;
	turnId: string | null;
	finalizedPreview: boolean;
	runtimePhase: "llm_call_started" | null;
};

const TERMINAL_STATUSES = new Set([
	"idle",
	"completed",
	"failed",
	"interrupted",
]);

function isTurnSwitch(
	currentTurnId: string | null | undefined,
	nextTurnId: string | null | undefined,
) {
	return Boolean(currentTurnId && nextTurnId && currentTurnId !== nextTurnId);
}

function markRuntimePhase(
	current: GenerationState,
	input: { turnId?: string | null; phase: "llm_call_started" },
): GenerationState {
	const nextTurnId = input.turnId ?? current.turnId ?? null;
	const turnSwitched = isTurnSwitch(current.turnId, input.turnId);
	const resumeFromTerminal = TERMINAL_STATUSES.has(current.status);
	const shouldResetResiduals = turnSwitched || resumeFromTerminal;
	const nextStatus =
		current.status === "idle" || resumeFromTerminal || turnSwitched
			? "pending"
			: current.status;
	return {
		...current,
		status: nextStatus,
		contentBlocks: shouldResetResiduals ? [] : current.contentBlocks,
		intermediateMessages: shouldResetResiduals
			? []
			: current.intermediateMessages,
		streamMessageId: shouldResetResiduals ? null : current.streamMessageId,
		messageOrdinal: shouldResetResiduals ? null : current.messageOrdinal,
		truncatedStart: shouldResetResiduals ? false : current.truncatedStart,
		patchSeq: shouldResetResiduals ? 0 : current.patchSeq,
		finalizedPreview: shouldResetResiduals ? false : current.finalizedPreview,
		turnId: nextTurnId,
		anchorUserMessageId: turnSwitched ? null : current.anchorUserMessageId,
		runtimePhase: input.phase,
	};
}

function applyProgress(
	current: GenerationState,
	input: {
		contentBlocks: ContentBlock[];
		intermediateMessages?: StreamingIntermediateMessage[];
		turnId?: string | null;
		finalizedPreview?: boolean;
		streamMessageId?: string | null;
		messageOrdinal?: number | null;
	},
): GenerationState {
	const nextTurnId = input.turnId ?? current.turnId ?? null;
	const turnSwitched = isTurnSwitch(current.turnId, input.turnId);
	return {
		...current,
		status: "streaming",
		contentBlocks: input.contentBlocks,
		intermediateMessages:
			input.intermediateMessages !== undefined
				? input.intermediateMessages
				: turnSwitched
					? []
					: current.intermediateMessages,
		streamMessageId:
			input.streamMessageId !== undefined
				? input.streamMessageId
				: turnSwitched
					? null
					: current.streamMessageId,
		messageOrdinal:
			input.messageOrdinal !== undefined
				? input.messageOrdinal
				: turnSwitched
					? null
					: current.messageOrdinal,
		truncatedStart: turnSwitched ? false : current.truncatedStart,
		patchSeq: turnSwitched ? 0 : current.patchSeq,
		turnId: nextTurnId,
		finalizedPreview: input.finalizedPreview ?? false,
		runtimePhase: null,
	};
}

function resumePending(
	current: GenerationState,
	input?: { turnId?: string | null },
): GenerationState {
	if (current.status === "streaming") return current;
	if (!TERMINAL_STATUSES.has(current.status)) return current;
	const turnSwitched = isTurnSwitch(current.turnId, input?.turnId);
	return {
		...current,
		status: "pending",
		contentBlocks: [],
		intermediateMessages: [],
		streamMessageId: null,
		messageOrdinal: null,
		truncatedStart: false,
		patchSeq: 0,
		anchorUserMessageId: turnSwitched ? null : current.anchorUserMessageId,
		turnId: input?.turnId ?? current.turnId ?? null,
		finalizedPreview: false,
		runtimePhase: null,
	};
}

function baseCompletedWithHandoff(): GenerationState {
	return {
		status: "completed",
		contentBlocks: [],
		intermediateMessages: [
			{
				id: "m1",
				messageId: "turn:t1:assistant:0",
				messageOrdinal: 0,
				content: [{ type: "text", text: "previous process step" }],
				text: "previous process step",
			},
		],
		streamMessageId: null,
		messageOrdinal: null,
		anchorUserMessageId: "t1-user",
		truncatedStart: false,
		patchSeq: 3,
		turnId: "t1",
		finalizedPreview: false,
		runtimePhase: null,
	};
}

test("lifecycle for next follow-up turn drops previous handoff residuals", () => {
	const next = markRuntimePhase(baseCompletedWithHandoff(), {
		turnId: "t2",
		phase: "llm_call_started",
	});

	assert.equal(next.status, "pending");
	assert.equal(next.turnId, "t2");
	assert.deepEqual(next.contentBlocks, []);
	assert.deepEqual(next.intermediateMessages, []);
	assert.equal(next.streamMessageId, null);
	assert.equal(next.messageOrdinal, null);
	assert.equal(next.patchSeq, 0);
	assert.equal(next.finalizedPreview, false);
	assert.equal(next.runtimePhase, "llm_call_started");
	assert.equal(next.anchorUserMessageId, null);
});

test("resumePending for next running follow-up clears completed handoff residuals", () => {
	const next = resumePending(baseCompletedWithHandoff(), { turnId: "t2" });

	assert.equal(next.status, "pending");
	assert.equal(next.turnId, "t2");
	assert.deepEqual(next.intermediateMessages, []);
	assert.deepEqual(next.contentBlocks, []);
	assert.equal(next.patchSeq, 0);
});

test("applyProgress on turn switch does not inherit previous intermediate history", () => {
	const residual: GenerationState = {
		...baseCompletedWithHandoff(),
		status: "pending",
		// Simulate a partial handoff where turnId already moved but residuals remain.
		turnId: "t1",
		intermediateMessages: [
			{
				id: "m1",
				content: [{ type: "text", text: "old process" }],
				text: "old process",
			},
		],
		contentBlocks: [{ type: "text", text: "old answer" }],
	};

	const next = applyProgress(residual, {
		turnId: "t2",
		contentBlocks: [{ type: "text", text: "new answer" }],
		// intermediateMessages intentionally omitted — must not keep t1 history
	});

	assert.equal(next.status, "streaming");
	assert.equal(next.turnId, "t2");
	assert.deepEqual(next.intermediateMessages, []);
	assert.equal(
		(next.contentBlocks[0] as { type: "text"; text: string }).text,
		"new answer",
	);
	assert.equal(next.streamMessageId, null);
	assert.equal(next.patchSeq, 0);
});

test("same-turn applyProgress still preserves intermediate history when omitted", () => {
	const current: GenerationState = {
		status: "streaming",
		contentBlocks: [{ type: "text", text: "draft" }],
		intermediateMessages: [
			{
				id: "m1",
				content: [{ type: "tool_use", id: "tool-1", name: "bash", input: {} }],
			},
		],
		streamMessageId: "turn:t1:assistant:1",
		messageOrdinal: 1,
		anchorUserMessageId: "t1-user",
		truncatedStart: false,
		patchSeq: 2,
		turnId: "t1",
		finalizedPreview: false,
		runtimePhase: null,
	};

	const next = applyProgress(current, {
		turnId: "t1",
		contentBlocks: [{ type: "text", text: "draft more" }],
	});

	assert.equal(next.intermediateMessages.length, 1);
	assert.equal(next.streamMessageId, "turn:t1:assistant:1");
	assert.equal(next.patchSeq, 2);
});

test("timeline does not paint previous process under the next follow-up turn", () => {
	// After handoff residual clear, streaming is pending on t2 with empty process.
	const items = buildTurnTimelineItems({
		sessionId: "s1",
		turns: [
			{
				id: "t1",
				sessionId: "s1",
				userUuid: null,
				sequence: 1,
				status: "completed",
				intent: "followup",
				userContent: [{ type: "text", text: "first" }],
				userText: "first",
				assistantContent: [{ type: "text", text: "answer one" }],
				assistantText: "answer one",
				provider: null,
				model: null,
				stopReason: "end_turn",
				errorMessage: null,
				finalUsage: null,
				totalUsage: null,
				summary: null,
				intermediateIndex: null,
				intermediateSummary: {
					messageCount: 1,
					toolCallCount: 1,
				},
				meta: null,
				startedAt: null,
				durationMs: null,
				completedAt: "2026-01-01T00:00:02.000Z",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:02.000Z",
			},
			{
				id: "t2",
				sessionId: "s1",
				userUuid: null,
				sequence: 2,
				status: "queued",
				intent: "followup",
				userContent: [{ type: "text", text: "second" }],
				userText: "second",
				assistantContent: null,
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
				startedAt: null,
				durationMs: null,
				completedAt: null,
				createdAt: "2026-01-01T00:00:03.000Z",
				updatedAt: "2026-01-01T00:00:03.000Z",
			},
		],
		streaming: {
			sessionId: "s1",
			turnId: "t2",
			contentBlocks: [],
			intermediateMessages: [],
			status: "pending",
			runtimePhase: "llm_call_started",
		},
	});

	const processItems = items.filter((item) => item.kind === "process");
	// t1 may keep its persisted intermediate summary process card, but no live
	// streaming process with residual content should be attached to t2.
	const streamingProcess = processItems.find(
		(item) => item.kind === "process" && item.streaming,
	);
	assert.equal(streamingProcess, undefined);

	const assistantPreviews = items.filter(
		(item) =>
			item.kind === "message" &&
			item.message.meta?.messageKind === "assistant_streaming_preview",
	);
	assert.equal(assistantPreviews.length, 0);

	const t1Assistant = items.find(
		(item) =>
			item.kind === "message" &&
			item.message.meta?.messageKind === "assistant_final" &&
			item.message.meta?.turnId === "t1",
	);
	assert.ok(t1Assistant);
	assert.equal(
		t1Assistant?.kind === "message" ? t1Assistant.message.text : null,
		"answer one",
	);
});

test("stale residual intermediate under next turn would duplicate answer — regression guard", () => {
	// Documents the buggy UI shape we fixed: completed handoff intermediate
	// still attached after turnId advanced to the next follow-up.
	const items = buildTurnTimelineItems({
		sessionId: "s1",
		turns: [
			{
				id: "t1",
				sessionId: "s1",
				userUuid: null,
				sequence: 1,
				status: "completed",
				intent: "followup",
				userContent: [{ type: "text", text: "first" }],
				userText: "first",
				assistantContent: [{ type: "text", text: "answer one" }],
				assistantText: "answer one",
				provider: null,
				model: null,
				stopReason: "end_turn",
				errorMessage: null,
				finalUsage: null,
				totalUsage: null,
				summary: null,
				intermediateIndex: null,
				intermediateSummary: null,
				meta: null,
				startedAt: null,
				durationMs: null,
				completedAt: "2026-01-01T00:00:02.000Z",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:02.000Z",
			},
			{
				id: "t2",
				sessionId: "s1",
				userUuid: null,
				sequence: 2,
				status: "queued",
				intent: "followup",
				userContent: [{ type: "text", text: "second" }],
				userText: "second",
				assistantContent: null,
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
				startedAt: null,
				durationMs: null,
				completedAt: null,
				createdAt: "2026-01-01T00:00:03.000Z",
				updatedAt: "2026-01-01T00:00:03.000Z",
			},
		],
		streaming: {
			sessionId: "s1",
			turnId: "t2",
			contentBlocks: [{ type: "text", text: "answer one" }],
			intermediateMessages: [
				{
					id: "m1",
					sessionId: "s1",
					role: "assistant",
					content: [{ type: "text", text: "previous process step" }],
					text: "previous process step",
					provider: null,
					model: null,
					stopReason: null,
					errorMessage: null,
					usage: null,
					durationMs: null,
					toolCallsObjectKey: null,
					meta: null,
					createdAt: "2026-01-01T00:00:01.000Z",
				},
			],
			status: "pending",
		},
	});

	// Without residual clear, t1 final + live residual preview both show
	// "answer one", and a streaming process from t1 is painted under t2.
	const texts = items
		.filter((item) => item.kind === "message")
		.map((item) => (item.kind === "message" ? item.message.text : ""))
		.filter(Boolean);
	assert.ok(texts.filter((text) => text === "answer one").length >= 2);

	const streamingProcess = items.find(
		(item) => item.kind === "process" && item.streaming,
	);
	assert.equal(streamingProcess?.kind, "process");
});
