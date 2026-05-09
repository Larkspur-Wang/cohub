import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { ChannelEnvelope } from "@neta-art/cohub-protocol/realtime";
import {
	applyRealtimeGenerationPatch,
	applyRealtimeGenerationProgress,
	applyRealtimeGenerationSnapshot,
	failGeneration,
	interruptGeneration,
} from "./session-generation-controller";

type HandledGenerationRealtimeEffect = {
	handled: true;
	shouldScroll: boolean;
	shouldReconcile: boolean;
	shouldRefreshSessions: boolean;
	shouldRestoreSnapshot?: boolean;
};

export type GenerationRealtimeEffect =
	| HandledGenerationRealtimeEffect
	| {
			handled: false;
			shouldScroll: false;
			shouldReconcile: false;
			shouldRefreshSessions: false;
	  };

type ParsedSnapshotMessage = {
	messageId: string | null;
	messageOrdinal: number | null;
	content: ContentBlock[];
	appendPath?: string | null;
};

function parseSnapshotMessage(value: unknown): ParsedSnapshotMessage | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.content)) return null;
	return {
		messageId: typeof record.messageId === "string" ? record.messageId : null,
		messageOrdinal:
			typeof record.messageOrdinal === "number" ? record.messageOrdinal : null,
		content: record.content as ContentBlock[],
		appendPath:
			typeof record.appendPath === "string" ? record.appendPath : null,
	};
}

export function applyGenerationRealtimeEnvelope(
	sessionId: string,
	payload: ChannelEnvelope,
): GenerationRealtimeEffect {
	if (payload.type === "session.turn.snapshot") {
		const current = parseSnapshotMessage(payload.payload.current);
		const intermediateMessages = Array.isArray(
			payload.payload.intermediateMessages,
		)
			? payload.payload.intermediateMessages
					.map(parseSnapshotMessage)
					.filter((message): message is ParsedSnapshotMessage =>
						Boolean(message),
					)
			: [];
		const seq = payload.payload.seq;
		if (!current || typeof seq !== "number") {
			return {
				handled: true,
				shouldScroll: false,
				shouldReconcile: true,
				shouldRefreshSessions: false,
			};
		}
		const result = applyRealtimeGenerationSnapshot(sessionId, {
			spaceId: typeof payload.spaceId === "string" ? payload.spaceId : null,
			turnId:
				typeof payload.payload.turnId === "string"
					? payload.payload.turnId
					: null,
			seq,
			anchorUserMessageId:
				typeof payload.payload.anchorUserMessageId === "string"
					? payload.payload.anchorUserMessageId
					: null,
			current,
			intermediateMessages,
		});
		return {
			handled: true,
			shouldScroll: result.applied,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	if (payload.type === "session.turn.patch") {
		const seq = payload.payload.seq;
		const baseSeq = payload.payload.baseSeq;
		const ops = payload.payload.ops;
		if (
			typeof seq !== "number" ||
			typeof baseSeq !== "number" ||
			!Array.isArray(ops)
		) {
			return {
				handled: true,
				shouldScroll: false,
				shouldReconcile: true,
				shouldRefreshSessions: false,
			};
		}
		const result = applyRealtimeGenerationPatch(sessionId, {
			spaceId: typeof payload.spaceId === "string" ? payload.spaceId : null,
			turnId:
				typeof payload.payload.turnId === "string"
					? payload.payload.turnId
					: null,
			seq,
			baseSeq,
			ops: ops as Parameters<typeof applyRealtimeGenerationPatch>[1]["ops"],
			messageId:
				typeof payload.payload.messageId === "string"
					? payload.payload.messageId
					: null,
			messageOrdinal:
				typeof payload.payload.messageOrdinal === "number"
					? payload.payload.messageOrdinal
					: null,
			anchorUserMessageId:
				typeof payload.payload.anchorUserMessageId === "string"
					? payload.payload.anchorUserMessageId
					: null,
		});
		return {
			handled: true,
			shouldScroll: result.applied,
			shouldReconcile: !result.applied && result.reason === "version_mismatch",
			shouldRefreshSessions: false,
			shouldRestoreSnapshot:
				!result.applied && result.reason === "version_mismatch",
		};
	}

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
			spaceId: typeof payload.spaceId === "string" ? payload.spaceId : null,
			turnId:
				typeof payload.payload.turnId === "string"
					? payload.payload.turnId
					: null,
			content,
			anchorUserMessageId,
			messageId:
				typeof payload.payload.messageId === "string"
					? payload.payload.messageId
					: null,
			messageOrdinal:
				typeof payload.payload.messageOrdinal === "number"
					? payload.payload.messageOrdinal
					: null,
		});
		return {
			handled: true,
			shouldScroll: true,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	if (payload.type === "session.message.persisted") {
		const message = payload.payload.message as
			| { role?: unknown; meta?: Record<string, unknown> | null }
			| null
			| undefined;
		if (message?.role === "assistant") {
			const kind = message.meta?.messageKind;
			return {
				handled: true,
				shouldScroll: false,
				shouldReconcile:
					kind === "assistant_final" || kind === "assistant_error",
				shouldRefreshSessions:
					kind === "assistant_final" || kind === "assistant_error",
			};
		}
		return {
			handled: true,
			shouldScroll: false,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	if (payload.type === "session.turn.finalized") {
		const turn = payload.payload.turn as
			| { status?: unknown }
			| null
			| undefined;
		if (turn?.status === "interrupted") {
			interruptGeneration(sessionId);
			return {
				handled: true,
				shouldScroll: false,
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

	if (payload.type === "session.turn.error") {
		const error =
			typeof payload.payload.error === "string" && payload.payload.error.trim()
				? payload.payload.error.trim().slice(0, 1000)
				: "Generation failed";
		failGeneration(sessionId, error);
		return {
			handled: true,
			shouldScroll: false,
			shouldReconcile: false,
			shouldRefreshSessions: false,
		};
	}

	return {
		handled: false,
		shouldScroll: false,
		shouldReconcile: false,
		shouldRefreshSessions: false,
	};
}
