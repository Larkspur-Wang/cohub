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
	if (current?.status === "streaming") return;
	realtimePatchReducer.start({
		sessionId,
		spaceId: input?.spaceId ?? null,
		turnId: input?.turnId ?? null,
	});
	sessionGenerationStore.startPending(sessionId, input);
}

export function applyRealtimeGenerationProgress(
	sessionId: string,
	input: {
		spaceId?: string | null;
		content: ContentBlock[];
		anchorUserMessageId?: string | null;
		messageId?: string | null;
		messageOrdinal?: number | null;
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	const resolvedSpaceId = input.spaceId ?? current?.spaceId ?? null;
	const nextStreamMessageId = resolveStreamMessageId({
		sessionId,
		turnId: current?.turnId,
		anchorUserMessageId: input.anchorUserMessageId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
	});

	if (input.content.length === 0) {
		if (!input.anchorUserMessageId && !nextStreamMessageId) return;
		sessionGenerationStore.applyProgress(sessionId, {
			spaceId: resolvedSpaceId,
			contentBlocks: current?.contentBlocks ?? [],
			intermediateMessages: current?.intermediateMessages ?? [],
			streamMessageId: nextStreamMessageId ?? current?.streamMessageId ?? null,
			messageOrdinal: input.messageOrdinal ?? current?.messageOrdinal ?? null,
			anchorUserMessageId:
				input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
			truncatedStart: current?.truncatedStart ?? false,
		});
		return;
	}

	const messageChanged = Boolean(
		nextStreamMessageId &&
			current?.streamMessageId &&
			nextStreamMessageId !== current.streamMessageId,
	);
	const intermediateMessages = messageChanged
		? appendCurrentMessageToIntermediate({
				contentBlocks: current?.contentBlocks ?? [],
				intermediateMessages: current?.intermediateMessages,
			})
		: (current?.intermediateMessages ?? []);
	const hadPreviousStreamingPreview = (current?.contentBlocks.length ?? 0) > 0;
	const hasExistingStreamingState =
		(current?.contentBlocks.length ?? 0) > 0 ||
		Boolean(current?.anchorUserMessageId);
	const shouldStartFreshPreview =
		hadPreviousStreamingPreview && current?.status !== "streaming";
	const previewBase = messageChanged
		? []
		: shouldStartFreshPreview
			? []
			: (current?.contentBlocks ?? []);
	const mergedContent = mergeStreamingDeltaBlocks(previewBase, input.content);
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: resolvedSpaceId,
		contentBlocks: mergedContent,
		intermediateMessages,
		streamMessageId: nextStreamMessageId ?? current?.streamMessageId ?? null,
		messageOrdinal: input.messageOrdinal ?? current?.messageOrdinal ?? null,
		anchorUserMessageId:
			input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
		truncatedStart:
			!hasExistingStreamingState && current?.status === "pending"
				? true
				: shouldStartFreshPreview
					? false
					: (current?.truncatedStart ?? false),
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
	const resolvedSpaceId = input.spaceId ?? current?.spaceId ?? null;
	const nextStreamMessageId = resolveStreamMessageId({
		sessionId,
		turnId: input.turnId,
		anchorUserMessageId: input.anchorUserMessageId,
		messageId: input.messageId,
		messageOrdinal: input.messageOrdinal,
	});
	const messageChanged = Boolean(
		nextStreamMessageId &&
			current?.streamMessageId &&
			nextStreamMessageId !== current.streamMessageId,
	);
	if (messageChanged) {
		realtimePatchReducer.start({
			sessionId,
			spaceId: resolvedSpaceId,
			turnId: input.turnId ?? current?.turnId ?? null,
		});
	}
	const result = realtimePatchReducer.applyPatch({
		sessionId,
		...input,
		spaceId: resolvedSpaceId,
	});
	if (!result.applied) {
		return {
			applied: false,
			reason: result.reason === "duplicate" ? "duplicate" : "version_mismatch",
		};
	}
	const intermediateMessages = messageChanged
		? appendCurrentMessageToIntermediate({
				contentBlocks: current?.contentBlocks ?? [],
				intermediateMessages: current?.intermediateMessages,
			})
		: (current?.intermediateMessages ?? []);
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: resolvedSpaceId ?? result.state.spaceId ?? null,
		contentBlocks: result.state.contentBlocks,
		intermediateMessages,
		streamMessageId: nextStreamMessageId ?? current?.streamMessageId ?? null,
		messageOrdinal: input.messageOrdinal ?? current?.messageOrdinal ?? null,
		anchorUserMessageId: result.state.anchorUserMessageId,
		truncatedStart:
			input.baseSeq !== 0 && current?.status === "pending"
				? true
				: messageChanged
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

export function completeGeneration(sessionId: string) {
	realtimePatchReducer.complete({ sessionId });
	sessionGenerationStore.complete(sessionId);
}

export function resetGeneration(sessionId: string | null | undefined) {
	if (sessionId) realtimePatchReducer.reset({ sessionId });
	sessionGenerationStore.reset(sessionId);
}
