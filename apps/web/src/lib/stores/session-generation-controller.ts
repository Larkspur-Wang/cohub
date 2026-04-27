import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { mergeStreamingDeltaBlocks } from "$lib/session-render";
import { sessionGenerationStore } from "./session-generation.svelte";

export function clearGenerationError(sessionId: string | null | undefined) {
	if (!sessionId) return;
	const current = sessionGenerationStore.get(sessionId);
	if (!current) return;
	sessionGenerationStore.bySessionId = {
		...sessionGenerationStore.bySessionId,
		[sessionId]: {
			...current,
			error: null,
		},
	};
}

export function startGenerationRequest(
	sessionId: string,
	input?: { clientMessageId?: string | null; requestId?: string | null },
) {
	clearGenerationError(sessionId);
	sessionGenerationStore.startPending(sessionId, input);
}

export function applyRealtimeGenerationProgress(
	sessionId: string,
	input: {
		content: ContentBlock[];
		anchorUserMessageId?: string | null;
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	if (input.content.length === 0) {
		if (!input.anchorUserMessageId) return;
		sessionGenerationStore.applyProgress(sessionId, {
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

export function failGeneration(sessionId: string, error?: string | null) {
	sessionGenerationStore.fail(sessionId, error ?? "Generation failed");
}

export function completeGeneration(sessionId: string) {
	sessionGenerationStore.complete(sessionId);
}

export function resetGeneration(sessionId: string | null | undefined) {
	sessionGenerationStore.reset(sessionId);
}
