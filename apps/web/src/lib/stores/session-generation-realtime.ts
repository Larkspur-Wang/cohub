import type { ContentBlock } from "@cohub/protocol/core";
import type {
	GenerationStreamEvent,
	GenerationStreamStateEvent,
} from "@neta-art/cohub";
import type { StreamingIntermediateMessage } from "./session-generation.svelte";
import { sessionGenerationStore } from "./session-generation.svelte";
import {
	failGeneration,
	interruptGeneration,
} from "./session-generation-controller";

type HandledGenerationRealtimeEffect = {
	handled: true;
	shouldScroll: boolean;
	shouldReconcile: boolean;
	shouldRestoreSnapshot: boolean;
	shouldRefreshSessions: boolean;
};

export type GenerationRealtimeEffect =
	| HandledGenerationRealtimeEffect
	| {
			handled: false;
			shouldScroll: false;
			shouldReconcile: false;
			shouldRestoreSnapshot: false;
			shouldRefreshSessions: false;
	  };

const ignoredEffect: GenerationRealtimeEffect = {
	handled: false,
	shouldScroll: false,
	shouldReconcile: false,
	shouldRestoreSnapshot: false,
	shouldRefreshSessions: false,
};

function handledEffect(
	input: Omit<HandledGenerationRealtimeEffect, "handled">,
): GenerationRealtimeEffect {
	return {
		handled: true,
		...input,
	};
}

/**
 * Extract visible text from content blocks, normalizing for comparison.
 * Empty/whitespace-only thinking and text blocks are excluded to match
 * the behavior of `buildStreamingPreviewBlocks`, which filters them out
 * during streaming.
 */
function getVisibleTextContent(blocks: ContentBlock[]): string {
	return blocks
		.map((block) => {
			if (block.type === "text") return block.text.trim();
			if (block.type === "thinking") return block.thinking.trim();
			return "";
		})
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Compare two sets of content blocks by their visible text content.
 * Used to avoid replacing streaming-accumulated blocks with the server's
 * final blocks when the rendered text is already identical.
 */
function isContentTextuallySame(a: ContentBlock[], b: ContentBlock[]): boolean {
	return getVisibleTextContent(a) === getVisibleTextContent(b);
}

function resolveFinalContent(turn: {
	assistantContent?: ContentBlock[] | null;
	assistantText?: string | null;
}): ContentBlock[] {
	if (
		Array.isArray(turn.assistantContent) &&
		turn.assistantContent.length > 0
	) {
		return turn.assistantContent;
	}
	if (turn.assistantText) {
		return [{ type: "text", text: turn.assistantText }];
	}
	return [];
}

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

function normalizeIntermediateMessages(
	messages: GenerationStreamStateEvent["intermediateMessages"] | undefined,
): StreamingIntermediateMessage[] {
	return (messages ?? [])
		.filter((message) => Array.isArray(message.content))
		.map((message) => ({
			...message,
			messageId: message.messageId ?? null,
			messageOrdinal: message.messageOrdinal ?? null,
			content: message.content,
		}));
}

function applyGenerationState(
	sessionId: string,
	event: GenerationStreamStateEvent,
) {
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: event.state.spaceId,
		contentBlocks: event.state.contentBlocks,
		intermediateMessages: normalizeIntermediateMessages(
			event.intermediateMessages,
		),
		streamMessageId: event.messageId,
		messageOrdinal: event.messageOrdinal,
		anchorUserMessageId: event.state.anchorUserMessageId,
		truncatedStart: shouldMarkTruncatedStart(sessionId, event),
		patchSeq: event.state.patchSeq,
		turnId: event.state.turnId,
	});
}

function shouldMarkTruncatedStart(
	sessionId: string,
	event: GenerationStreamStateEvent,
) {
	const current = sessionGenerationStore.get(sessionId);
	if (!current || current.status !== "pending") return false;
	if (event.source === "patch") {
		return event.state.patchSeq > 0 && current.contentBlocks.length === 0;
	}
	if (event.source === "progress") {
		return (
			event.state.patchSeq === 0 &&
			current.contentBlocks.length === 0 &&
			event.state.contentBlocks.length > 0
		);
	}
	return false;
}

export function applyGenerationStreamSnapshot(
	sessionId: string,
	input: {
		spaceId?: string | null;
		turnId?: string | null;
		seq: number;
		anchorUserMessageId?: string | null;
		current: {
			messageId?: string | null;
			messageOrdinal?: number | null;
			content: ContentBlock[];
		};
		intermediateMessages?: StreamingIntermediateMessage[];
	},
) {
	const current = sessionGenerationStore.get(sessionId);
	const resolvedTurnId = input.turnId ?? current?.turnId ?? null;
	if (
		current?.turnId &&
		resolvedTurnId &&
		current.turnId === resolvedTurnId &&
		current.patchSeq > input.seq
	) {
		return { applied: false, reason: "stale_snapshot" as const };
	}
	// If the snapshot content is textually identical to the current
	// streaming-accumulated content, skip the contentBlocks update to
	// avoid resetting the StreamingMarkdownController's typing animation.
	// Other fields (patchSeq, turnId, etc.) are still applied.
	const currentBlocks = current?.contentBlocks ?? [];
	const snapshotBlocks = input.current.content;
	const skipContentUpdate =
		snapshotBlocks.length > 0 &&
		isContentTextuallySame(currentBlocks, snapshotBlocks);
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: input.spaceId ?? current?.spaceId ?? null,
		contentBlocks: skipContentUpdate ? currentBlocks : snapshotBlocks,
		intermediateMessages: input.intermediateMessages ?? [],
		streamMessageId: resolveStreamMessageId({
			sessionId,
			turnId: resolvedTurnId,
			anchorUserMessageId:
				input.anchorUserMessageId ?? current?.anchorUserMessageId,
			messageId: input.current.messageId,
			messageOrdinal: input.current.messageOrdinal,
		}),
		messageOrdinal: input.current.messageOrdinal ?? null,
		anchorUserMessageId:
			input.anchorUserMessageId ?? current?.anchorUserMessageId ?? null,
		truncatedStart: false,
		patchSeq: input.seq,
		turnId: resolvedTurnId,
	});
	return { applied: true as const };
}

export function applyGenerationStreamEvent(
	sessionId: string,
	event: GenerationStreamEvent,
): GenerationRealtimeEffect {
	if (event.type === "state") {
		applyGenerationState(sessionId, event);
		return handledEffect({
			shouldScroll: true,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "commit") {
		if (event.commit.kind === "final" || event.commit.kind === "error") {
			return handledEffect({
				shouldScroll: false,
				shouldReconcile: true,
				shouldRestoreSnapshot: false,
				shouldRefreshSessions: true,
			});
		}
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "finalized") {
		if (
			event.turn.status === "interrupted" ||
			event.turn.status === "merged" ||
			event.turn.status === "cancelled"
		) {
			interruptGeneration(sessionId);
			return handledEffect({
				shouldScroll: false,
				shouldReconcile: true,
				shouldRestoreSnapshot: false,
				shouldRefreshSessions: true,
			});
		}
		// For completed turns, avoid replacing the streaming-accumulated
		// contentBlocks with the server's final blocks when the visible text
		// is already equivalent. Replacing blocks resets the
		// StreamingMarkdownController's typing animation because the new
		// source may not extend the currently displayed source (e.g. blocks
		// in a different order, empty thinking blocks added/removed, trailing
		// whitespace differences). The streaming preview already shows the
		// complete text, and hydrateTurnOnce + completeGeneration will swap
		// it for the persisted final message shortly after.
		const finalContent = resolveFinalContent(event.turn);
		if (finalContent.length > 0) {
			const current = sessionGenerationStore.get(sessionId);
			const currentBlocks = current?.contentBlocks ?? [];
			if (!isContentTextuallySame(currentBlocks, finalContent)) {
				sessionGenerationStore.applyProgress(sessionId, {
					contentBlocks: finalContent,
					turnId: event.turn.id,
					finalizedPreview: true,
				});
			}
		}
		return handledEffect({
			shouldScroll: true,
			shouldReconcile: true,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: true,
		});
	}

	if (event.type === "error") {
		failGeneration(sessionId, event.message);
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: false,
			shouldRestoreSnapshot: false,
			shouldRefreshSessions: false,
		});
	}

	if (event.type === "out_of_sync") {
		const shouldRestoreSnapshot =
			event.reason === "version_mismatch" && event.source === "patch";
		return handledEffect({
			shouldScroll: false,
			shouldReconcile: true,
			shouldRestoreSnapshot,
			shouldRefreshSessions: false,
		});
	}

	return ignoredEffect;
}
