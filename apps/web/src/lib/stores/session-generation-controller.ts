import {
	createSessionPatchReducer,
	type SessionPatchApplyInput,
} from "@neta-art/cohub";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { mergeStreamingDeltaBlocks } from "$lib/session-streaming";
import { sessionGenerationStore } from "./session-generation.svelte";

type PatchApplyResult =
	| { applied: true }
	| { applied: false; reason: "duplicate" | "version_mismatch" };

const realtimePatchReducer = createSessionPatchReducer();

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
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	if (input.content.length === 0) {
		if (!input.anchorUserMessageId) return;
		sessionGenerationStore.applyProgress(sessionId, {
			spaceId: input.spaceId,
			contentBlocks: current?.contentBlocks ?? [],
			anchorUserMessageId: input.anchorUserMessageId,
			truncatedStart: current?.truncatedStart ?? false,
		});
		return;
	}
	const hadPreviousStreamingPreview = (current?.contentBlocks.length ?? 0) > 0;
	const hasExistingStreamingState =
		(current?.contentBlocks.length ?? 0) > 0 ||
		Boolean(current?.anchorUserMessageId);
	const shouldStartFreshPreview =
		hadPreviousStreamingPreview && current?.status !== "streaming";
	const previewBase = shouldStartFreshPreview
		? []
		: (current?.contentBlocks ?? []);
	const mergedContent = mergeStreamingDeltaBlocks(previewBase, input.content);
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: input.spaceId,
		contentBlocks: mergedContent,
		anchorUserMessageId: input.anchorUserMessageId,
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
		seq: number;
		baseSeq: number;
		ops: SessionPatchApplyInput["ops"];
		anchorUserMessageId?: string | null;
	},
): PatchApplyResult {
	const current = sessionGenerationStore.get(sessionId);
	const result = realtimePatchReducer.applyPatch({ sessionId, ...input });
	if (!result.applied) {
		return {
			applied: false,
			reason: result.reason === "duplicate" ? "duplicate" : "version_mismatch",
		};
	}
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: input.spaceId ?? result.state.spaceId ?? null,
		contentBlocks: result.state.contentBlocks,
		anchorUserMessageId: result.state.anchorUserMessageId,
		truncatedStart:
			input.baseSeq !== 0 && current?.status === "pending"
				? true
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
