import type {
	GenerationStreamEvent,
	GenerationStreamStateEvent,
} from "@neta-art/cohub";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
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
	sessionGenerationStore.applyProgress(sessionId, {
		spaceId: input.spaceId ?? current?.spaceId ?? null,
		contentBlocks: input.current.content,
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
		if (event.turn.status === "interrupted") {
			interruptGeneration(sessionId);
			return handledEffect({
				shouldScroll: false,
				shouldReconcile: true,
				shouldRestoreSnapshot: false,
				shouldRefreshSessions: true,
			});
		}
		return ignoredEffect;
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
