import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { ChannelEnvelope } from "@neta-art/cohub-protocol/realtime";
import {
	applyRealtimeGenerationProgress,
	failGeneration,
} from "./session-generation-controller";

export type GenerationRealtimeEffect = {
	handled: boolean;
	shouldScroll: boolean;
	shouldReconcile: boolean;
	shouldRefreshSessions: boolean;
};

export function applyGenerationRealtimeEnvelope(
	sessionId: string,
	payload: ChannelEnvelope,
): GenerationRealtimeEffect {
	if (payload.type === "session.turn.progress") {
		const content = Array.isArray(payload.payload.content)
			? (payload.payload.content as ContentBlock[])
			: [];
		if (content.length === 0) {
			return {
				handled: true,
				shouldScroll: false,
				shouldReconcile: false,
				shouldRefreshSessions: false,
			};
		}
		const anchorUserMessageId =
			typeof payload.payload.anchorUserMessageId === "string"
				? payload.payload.anchorUserMessageId
				: null;
		applyRealtimeGenerationProgress(sessionId, {
			content,
			anchorUserMessageId,
		});
		return {
			handled: true,
			shouldScroll: true,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	if (payload.type === "session.turn.error") {
		failGeneration(sessionId, "Generation failed");
		return {
			handled: true,
			shouldScroll: false,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	if (payload.type === "session.turn.final") {
		return {
			handled: true,
			shouldScroll: true,
			shouldReconcile: true,
			shouldRefreshSessions: true,
		};
	}

	return {
		handled: false,
		shouldScroll: false,
		shouldReconcile: false,
		shouldRefreshSessions: false,
	};
}
