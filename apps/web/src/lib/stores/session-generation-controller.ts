import {
	createSessionPatchReducer,
	type SessionPatchApplyInput,
} from "@neta-art/cohub";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { StoredIntermediateMessage } from "@neta-art/cohub-protocol/model";
import { mergeStreamingDeltaBlocks } from "$lib/session-streaming";
import { createStreamingIntermediateMessage } from "$lib/session-streaming-message";
import { sessionGenerationStore } from "./session-generation.svelte";

type PatchApplyResult =
	| { applied: true }
	| { applied: false; reason: "duplicate" | "version_mismatch" };

const realtimePatchReducer = createSessionPatchReducer();

function resolveStreamMessageId(input: {
	sessionId: string;
	turnId?: string | null;
	anchorUserMessageId?: string | null;
	messageId?: string | null;
	messageOrdinal?: number | null;
}) {
	if (input.messageId?.trim()) return input.messageId.trim();
	if (input.messageOrdinal == null) return null;
	if (input.turnId?.trim()) {
		return `turn:${input.turnId.trim()}:assistant:${input.messageOrdinal}`;
	}
	return `session:${input.sessionId}:assistant:${input.messageOrdinal}:${input.anchorUserMessageId ?? "unknown"}`;
}

function appendCurrentMessageToIntermediate(input: {
	contentBlocks: ContentBlock[];
	intermediateMessages?: ContentBlock[][];
}) {
	if (input.contentBlocks.length === 0) return input.intermediateMessages ?? [];
	return [...(input.intermediateMessages ?? []), input.contentBlocks];
}

export function buildStreamingStoredIntermediateMessages(input: {
	spaceId?: string | null;
	sessionId: string;
	turnId?: string | null;
	intermediateMessages?: ContentBlock[][];
}): StoredIntermediateMessage[] {
	return (input.intermediateMessages ?? [])
		.map((contentBlocks, index) =>
			createStreamingIntermediateMessage({
				spaceId: input.spaceId,
				sessionId: input.sessionId,
				turnId: input.turnId,
				streamMessageId: `stream:${input.sessionId}:${input.turnId ?? "turn"}:intermediate:${index}`,
				messageOrdinal: index,
				contentBlocks,
			}),
		)
		.filter((message): message is StoredIntermediateMessage =>
			Boolean(message),
		);
}

type StreamDebugStats = {
	startedAt: number;
	events: number;
	patches: number;
	progresses: number;
	messageChanged: number;
	differentTurn: number;
	lastTurnId: string | null;
	lastStreamMessageId: string | null;
	streamMessageIds: string[];
	messageOrdinals: Array<number | null>;
	intermediateMessages: number;
	lastSeq: number | null;
	lastBaseSeq: number | null;
	lastOps: number | null;
};

const streamDebugStatsBySession = new Map<string, StreamDebugStats>();
let streamDebugReportTimer: ReturnType<typeof setTimeout> | null = null;

function debugStreamEnabled() {
	try {
		return globalThis.localStorage?.getItem("cohub:debug:stream") === "1";
	} catch {
		return false;
	}
}

function getStreamDebugStats(sessionId: string): StreamDebugStats {
	let stats = streamDebugStatsBySession.get(sessionId);
	if (!stats) {
		stats = {
			startedAt: Date.now(),
			events: 0,
			patches: 0,
			progresses: 0,
			messageChanged: 0,
			differentTurn: 0,
			lastTurnId: null,
			lastStreamMessageId: null,
			streamMessageIds: [],
			messageOrdinals: [],
			intermediateMessages: 0,
			lastSeq: null,
			lastBaseSeq: null,
			lastOps: null,
		};
		streamDebugStatsBySession.set(sessionId, stats);
	}
	return stats;
}

function scheduleStreamDebugReport() {
	if (streamDebugReportTimer) return;
	streamDebugReportTimer = setTimeout(() => {
		streamDebugReportTimer = null;
		if (!debugStreamEnabled()) return;
		const rows = [...streamDebugStatsBySession.entries()].map(
			([sessionId, stats]) => ({
				sessionId,
				seconds: Math.round((Date.now() - stats.startedAt) / 1000),
				events: stats.events,
				patches: stats.patches,
				progresses: stats.progresses,
				messageChanged: stats.messageChanged,
				differentTurn: stats.differentTurn,
				streamMessages: new Set(stats.streamMessageIds).size,
				lastStreamMessageId: stats.lastStreamMessageId,
				ordinals: [...new Set(stats.messageOrdinals)].join(","),
				intermediateMessages: stats.intermediateMessages,
				lastTurnId: stats.lastTurnId,
				lastSeq: stats.lastSeq,
				lastBaseSeq: stats.lastBaseSeq,
				lastOps: stats.lastOps,
			}),
		);
		console.table(rows);
	}, 1200);
}

function debugStream(label: string, payload: Record<string, unknown>) {
	if (!debugStreamEnabled()) return;
	const sessionId = String(payload.sessionId ?? "unknown");
	const stats = getStreamDebugStats(sessionId);
	stats.events += 1;
	if (label === "patch") stats.patches += 1;
	if (label === "progress") stats.progresses += 1;
	if (payload.messageChanged === true) stats.messageChanged += 1;
	if (payload.isDifferentTurn === true) stats.differentTurn += 1;
	stats.lastTurnId = typeof payload.turnId === "string" ? payload.turnId : null;
	stats.lastStreamMessageId =
		typeof payload.nextStreamMessageId === "string"
			? payload.nextStreamMessageId
			: stats.lastStreamMessageId;
	if (typeof payload.nextStreamMessageId === "string") {
		stats.streamMessageIds.push(payload.nextStreamMessageId);
	}
	stats.messageOrdinals.push(
		typeof payload.messageOrdinal === "number" ? payload.messageOrdinal : null,
	);
	stats.intermediateMessages =
		typeof payload.intermediateMessages === "number"
			? payload.intermediateMessages
			: stats.intermediateMessages;
	stats.lastSeq = typeof payload.seq === "number" ? payload.seq : stats.lastSeq;
	stats.lastBaseSeq =
		typeof payload.baseSeq === "number" ? payload.baseSeq : stats.lastBaseSeq;
	stats.lastOps = typeof payload.ops === "number" ? payload.ops : stats.lastOps;
	scheduleStreamDebugReport();
}

export function clearGenerationError(sessionId: string | null | undefined) {
	sessionGenerationStore.clearError(sessionId);
}

export function startGenerationRequest(
	sessionId: string,
	input?: {
		requestId?: string | null;
		spaceId?: string | null;
		turnId?: string | null;
	},
) {
	clearGenerationError(sessionId);
	const current = sessionGenerationStore.get(sessionId);
	const isDifferentTurn = Boolean(
		input?.turnId && current?.turnId && input.turnId !== current.turnId,
	);
	if (current?.status === "streaming" && !isDifferentTurn) return;
	realtimePatchReducer.start({
		sessionId,
		spaceId: input?.spaceId ?? current?.spaceId ?? null,
		turnId: input?.turnId ?? null,
	});
	sessionGenerationStore.startPending(sessionId, input);
}

export function applyRealtimeGenerationProgress(
	sessionId: string,
	input: {
		spaceId?: string | null;
		turnId?: string | null;
		content: ContentBlock[];
		anchorUserMessageId?: string | null;
		messageId?: string | null;
		messageOrdinal?: number | null;
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	const currentContentBlocks = current?.contentBlocks ?? [];
	const currentIntermediateMessages = current?.intermediateMessages ?? [];
	const currentStreamMessageId = current?.streamMessageId ?? null;
	const currentMessageOrdinal = current?.messageOrdinal ?? null;
	const currentAnchorUserMessageId = current?.anchorUserMessageId ?? null;
	const incomingTurnId = input.turnId ?? null;
	const isDifferentTurn = Boolean(
		incomingTurnId && current?.turnId && incomingTurnId !== current.turnId,
	);
	const baseContentBlocks = isDifferentTurn ? [] : currentContentBlocks;
	const baseIntermediateMessages = isDifferentTurn
		? []
		: currentIntermediateMessages;
	const baseStreamMessageId = isDifferentTurn ? null : currentStreamMessageId;
	const baseMessageOrdinal = isDifferentTurn ? null : currentMessageOrdinal;
	const baseAnchorUserMessageId = isDifferentTurn
		? null
		: currentAnchorUserMessageId;
	const resolvedSpaceId = input.spaceId ?? current?.spaceId ?? null;
	const resolvedTurnId =
		incomingTurnId ?? (isDifferentTurn ? null : current?.turnId) ?? null;
	const nextStreamMessageId = resolveStreamMessageId({
		sessionId,
		turnId: resolvedTurnId,
		anchorUserMessageId: input.anchorUserMessageId ?? baseAnchorUserMessageId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
	});

	if (input.content.length === 0) {
		if (!input.anchorUserMessageId && !nextStreamMessageId) return;
		sessionGenerationStore.applyProgress(sessionId, {
			spaceId: resolvedSpaceId,
			contentBlocks: baseContentBlocks,
			intermediateMessages: baseIntermediateMessages,
			streamMessageId: nextStreamMessageId ?? baseStreamMessageId,
			messageOrdinal: input.messageOrdinal ?? baseMessageOrdinal,
			anchorUserMessageId: input.anchorUserMessageId ?? baseAnchorUserMessageId,
			truncatedStart: isDifferentTurn
				? false
				: (current?.truncatedStart ?? false),
			turnId: resolvedTurnId,
		});
		return;
	}

	const messageChanged = Boolean(
		nextStreamMessageId &&
			currentContentBlocks.length > 0 &&
			((currentStreamMessageId &&
				nextStreamMessageId !== currentStreamMessageId) ||
				(!currentStreamMessageId && current?.status === "streaming")),
	);
	const shouldStartFreshPreview =
		baseContentBlocks.length > 0 && current?.status !== "streaming";
	const previewBase = messageChanged
		? []
		: shouldStartFreshPreview
			? []
			: baseContentBlocks;
	const mergedContent = mergeStreamingDeltaBlocks(previewBase, input.content);
	const intermediateMessages = messageChanged
		? appendCurrentMessageToIntermediate({
				contentBlocks: currentContentBlocks,
				intermediateMessages: currentIntermediateMessages,
			})
		: baseIntermediateMessages;
	debugStream("progress", {
		sessionId,
		turnId: resolvedTurnId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
		nextStreamMessageId,
		currentStreamMessageId,
		messageChanged,
		isDifferentTurn,
		contentBlocks: currentContentBlocks.length,
		intermediateMessages: intermediateMessages.length,
	});
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: resolvedSpaceId,
		contentBlocks: mergedContent,
		intermediateMessages,
		streamMessageId: nextStreamMessageId ?? baseStreamMessageId,
		messageOrdinal: input.messageOrdinal ?? baseMessageOrdinal,
		anchorUserMessageId: input.anchorUserMessageId ?? baseAnchorUserMessageId,
		truncatedStart:
			!isDifferentTurn &&
			baseContentBlocks.length === 0 &&
			current?.status === "pending"
				? true
				: shouldStartFreshPreview
					? false
					: (current?.truncatedStart ?? false),
		turnId: resolvedTurnId,
	});
}

export function applyRealtimeGenerationPatch(
	sessionId: string,
	input: {
		spaceId?: string | null;
		turnId?: string | null;
		messageId?: string | null;
		messageOrdinal?: number | null;
		seq: number;
		baseSeq: number;
		ops: SessionPatchApplyInput["ops"];
		anchorUserMessageId?: string | null;
	},
): PatchApplyResult {
	const current = sessionGenerationStore.get(sessionId);
	const currentContentBlocks = current?.contentBlocks ?? [];
	const currentIntermediateMessages = current?.intermediateMessages ?? [];
	const currentStreamMessageId = current?.streamMessageId ?? null;
	const currentMessageOrdinal = current?.messageOrdinal ?? null;
	const incomingTurnId = input.turnId ?? null;
	const isDifferentTurn = Boolean(
		incomingTurnId && current?.turnId && incomingTurnId !== current.turnId,
	);
	const baseIntermediateMessages = isDifferentTurn
		? []
		: currentIntermediateMessages;
	const baseStreamMessageId = isDifferentTurn ? null : currentStreamMessageId;
	const baseMessageOrdinal = isDifferentTurn ? null : currentMessageOrdinal;
	const resolvedSpaceId = input.spaceId ?? current?.spaceId ?? null;
	const resolvedTurnId =
		incomingTurnId ?? (isDifferentTurn ? null : current?.turnId) ?? null;
	const nextStreamMessageId = resolveStreamMessageId({
		sessionId,
		turnId: resolvedTurnId,
		anchorUserMessageId: input.anchorUserMessageId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
	});
	const messageChanged = Boolean(
		nextStreamMessageId &&
			currentContentBlocks.length > 0 &&
			((currentStreamMessageId &&
				nextStreamMessageId !== currentStreamMessageId) ||
				(!currentStreamMessageId && current?.status === "streaming")),
	);
	if (isDifferentTurn || messageChanged) {
		realtimePatchReducer.start({
			sessionId,
			spaceId: resolvedSpaceId,
			turnId: resolvedTurnId,
		});
	}
	const result = realtimePatchReducer.applyPatch({
		sessionId,
		...input,
		spaceId: resolvedSpaceId,
		turnId: resolvedTurnId,
	});
	if (!result.applied) {
		return {
			applied: false,
			reason: result.reason === "duplicate" ? "duplicate" : "version_mismatch",
		};
	}
	const intermediateMessages = messageChanged
		? appendCurrentMessageToIntermediate({
				contentBlocks: currentContentBlocks,
				intermediateMessages: currentIntermediateMessages,
			})
		: baseIntermediateMessages;
	debugStream("patch", {
		sessionId,
		turnId: resolvedTurnId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
		nextStreamMessageId,
		currentStreamMessageId,
		messageChanged,
		isDifferentTurn,
		seq: input.seq,
		baseSeq: input.baseSeq,
		ops: input.ops.length,
		contentBlocks: currentContentBlocks.length,
		resultBlocks: result.state.contentBlocks.length,
		intermediateMessages: intermediateMessages.length,
	});
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: resolvedSpaceId ?? result.state.spaceId ?? null,
		contentBlocks: result.state.contentBlocks,
		intermediateMessages,
		streamMessageId: nextStreamMessageId ?? baseStreamMessageId,
		messageOrdinal: input.messageOrdinal ?? baseMessageOrdinal,
		anchorUserMessageId: result.state.anchorUserMessageId,
		truncatedStart:
			!isDifferentTurn && input.baseSeq !== 0 && current?.status === "pending"
				? true
				: messageChanged || isDifferentTurn
					? false
					: (current?.truncatedStart ?? false),
		patchSeq: result.state.patchSeq,
		turnId: result.state.turnId,
	});
	return { applied: true };
}

export function failGeneration(sessionId: string, error?: string | null) {
	realtimePatchReducer.fail({ sessionId });
	sessionGenerationStore.fail(sessionId, error ?? "Generation failed");
}

export function replaceGenerationTurnId(
	sessionId: string,
	input: { previousTurnId?: string | null; nextTurnId: string | null },
) {
	realtimePatchReducer.replaceTurnId({
		sessionId,
		turnId: input.previousTurnId ?? null,
		nextTurnId: input.nextTurnId,
	});
	sessionGenerationStore.replaceTurnId(sessionId, input);
}

export function completeGeneration(sessionId: string) {
	realtimePatchReducer.complete({ sessionId });
	sessionGenerationStore.complete(sessionId);
}

export function resetGeneration(sessionId: string | null | undefined) {
	if (sessionId) realtimePatchReducer.reset({ sessionId });
	sessionGenerationStore.reset(sessionId);
}
