import type { ContentBlock } from "@neta-art/cohub-protocol/core";

export type SessionGenerationStatus =
	| "idle"
	| "pending"
	| "streaming"
	| "completed"
	| "failed";

export type SessionGenerationState = {
	sessionId: string;
	status: SessionGenerationStatus;
	requestId?: string | null;
	error?: string | null;
	startedAt?: number;
	lastEventAt?: number;
	contentBlocks: ContentBlock[];
	anchorUserMessageId: string | null;
	truncatedStart: boolean;
	patchSeq: number;
	turnId: string | null;
};

const createIdleState = (sessionId: string): SessionGenerationState => ({
	sessionId,
	status: "idle",
	requestId: null,
	error: null,
	startedAt: undefined,
	lastEventAt: undefined,
	contentBlocks: [],
	anchorUserMessageId: null,
	truncatedStart: false,
	patchSeq: 0,
	turnId: null,
});

class SessionGenerationStore {
	bySessionId = $state<Record<string, SessionGenerationState>>({});

	get(sessionId: string | null | undefined): SessionGenerationState | null {
		if (!sessionId) return null;
		return this.bySessionId[sessionId] ?? createIdleState(sessionId);
	}

	isStreaming(sessionId: string | null | undefined): boolean {
		if (!sessionId) return false;
		const state = this.bySessionId[sessionId];
		return state?.status === "streaming";
	}

	isGenerating(sessionId: string | null | undefined): boolean {
		if (!sessionId) return false;
		const state = this.bySessionId[sessionId];
		return state?.status === "pending" || state?.status === "streaming";
	}

	startPending(sessionId: string, input?: { requestId?: string | null }) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: {
				...current,
				sessionId,
				status: "pending",
				requestId: input?.requestId ?? current.requestId ?? null,
				error: null,
				startedAt: current.startedAt ?? Date.now(),
				lastEventAt: Date.now(),
				contentBlocks: [],
				anchorUserMessageId: null,
				truncatedStart: false,
				patchSeq: 0,
				turnId: null,
			},
		};
	}

	applyProgress(
		sessionId: string,
		input: {
			contentBlocks: ContentBlock[];
			anchorUserMessageId?: string | null;
			truncatedStart?: boolean;
			patchSeq?: number;
			turnId?: string | null;
		},
	) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: {
				...current,
				status: "streaming",
				error: null,
				startedAt: current.startedAt ?? Date.now(),
				lastEventAt: Date.now(),
				contentBlocks: input.contentBlocks,
				anchorUserMessageId:
					input.anchorUserMessageId ?? current.anchorUserMessageId ?? null,
				truncatedStart: input.truncatedStart ?? current.truncatedStart,
				patchSeq: input.patchSeq ?? current.patchSeq,
				turnId: input.turnId ?? current.turnId ?? null,
			},
		};
	}

	complete(sessionId: string) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: {
				...current,
				status: "completed",
				error: null,
				lastEventAt: Date.now(),
				contentBlocks: [],
				anchorUserMessageId: null,
				truncatedStart: false,
				patchSeq: current.patchSeq,
				turnId: current.turnId,
			},
		};
	}

	fail(sessionId: string, error?: string | null) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: {
				...current,
				status: "failed",
				error: error ?? current.error ?? null,
				lastEventAt: Date.now(),
				contentBlocks: [],
				anchorUserMessageId: null,
				truncatedStart: false,
				patchSeq: current.patchSeq,
				turnId: current.turnId,
			},
		};
	}

	reset(sessionId: string | null | undefined) {
		if (!sessionId) return;
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: createIdleState(sessionId),
		};
	}

	resetAll() {
		this.bySessionId = {};
	}
}

export const sessionGenerationStore = new SessionGenerationStore();
