import type { ContentBlock, Usage } from "@cohub/protocol/core";
import { authStore } from "$lib/stores/auth.svelte";

export type SessionGenerationStatus =
	| "idle"
	| "pending"
	| "streaming"
	| "completed"
	| "failed"
	| "interrupted";

export type StreamingIntermediateMessage = {
	messageId?: string | null;
	messageOrdinal?: number | null;
	content: ContentBlock[];
	id?: string;
	sessionId?: string;
	role?: "user" | "assistant" | "system";
	text?: string | null;
	provider?: string | null;
	model?: string | null;
	stopReason?: string | null;
	errorMessage?: string | null;
	usage?: Usage | null;
	durationMs?: number | null;
	toolCallsObjectKey?: string | null;
	meta?: Record<string, unknown> | null;
	createdAt?: string;
};

export type SessionGenerationState = {
	spaceId?: string | null;
	sessionId: string;
	status: SessionGenerationStatus | string;
	requestId?: string | null;
	error?: string | null;
	startedAt?: number;
	lastEventAt?: number;
	contentBlocks: ContentBlock[];
	intermediateMessages: StreamingIntermediateMessage[];
	streamMessageId: string | null;
	messageOrdinal: number | null;
	anchorUserMessageId: string | null;
	truncatedStart: boolean;
	patchSeq: number;
	turnId: string | null;
	finalizedPreview: boolean;
};

type PersistedGenerationState = SessionGenerationState & {
	version: 1;
	userKey: string;
};

const STORAGE_PREFIX = "cohub:generation";
const STORAGE_VERSION = 1;
const STORAGE_TTL_MS = 2 * 60 * 60 * 1000;
const STORAGE_WRITE_DEBOUNCE_MS = 250;
const MAX_PERSISTED_ERROR_LENGTH = 1000;
const TERMINAL_STATUSES = new Set([
	"idle",
	"completed",
	"failed",
	"interrupted",
]);

const createIdleState = (sessionId: string): SessionGenerationState => ({
	sessionId,
	spaceId: null,
	status: "idle",
	requestId: null,
	error: null,
	startedAt: undefined,
	lastEventAt: undefined,
	contentBlocks: [],
	intermediateMessages: [],
	streamMessageId: null,
	messageOrdinal: null,
	anchorUserMessageId: null,
	truncatedStart: false,
	patchSeq: 0,
	turnId: null,
	finalizedPreview: false,
});

function getStorage(): Storage | null {
	return typeof globalThis.localStorage === "undefined"
		? null
		: globalThis.localStorage;
}

function getUserKey() {
	return authStore.userUuid ?? "guest";
}

function storageKey(sessionId: string, userKey = getUserKey()) {
	return `${STORAGE_PREFIX}:${userKey}:${sessionId}:v${STORAGE_VERSION}`;
}

function isPersistable(state: SessionGenerationState) {
	return !TERMINAL_STATUSES.has(state.status);
}

function isFresh(state: SessionGenerationState) {
	const lastEventAt = state.lastEventAt ?? state.startedAt ?? 0;
	return lastEventAt > 0 && Date.now() - lastEventAt <= STORAGE_TTL_MS;
}

function sanitizeError(error: string | null | undefined) {
	const trimmed = error?.trim();
	return trimmed ? trimmed.slice(0, MAX_PERSISTED_ERROR_LENGTH) : null;
}

function parseIntermediateMessage(
	value: unknown,
): StreamingIntermediateMessage | null {
	if (Array.isArray(value)) return { content: value as ContentBlock[] };
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.content)) return null;
	return {
		...record,
		content: record.content as ContentBlock[],
		messageId: typeof record.messageId === "string" ? record.messageId : null,
		messageOrdinal:
			typeof record.messageOrdinal === "number" ? record.messageOrdinal : null,
		id: typeof record.id === "string" ? record.id : undefined,
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : undefined,
		role:
			record.role === "user" ||
			record.role === "assistant" ||
			record.role === "system"
				? record.role
				: undefined,
		text: typeof record.text === "string" ? record.text : null,
		provider: typeof record.provider === "string" ? record.provider : null,
		model: typeof record.model === "string" ? record.model : null,
		stopReason:
			typeof record.stopReason === "string" ? record.stopReason : null,
		errorMessage:
			typeof record.errorMessage === "string" ? record.errorMessage : null,
		usage:
			record.usage && typeof record.usage === "object"
				? (record.usage as Usage)
				: null,
		durationMs:
			typeof record.durationMs === "number" ? record.durationMs : null,
		toolCallsObjectKey:
			typeof record.toolCallsObjectKey === "string"
				? record.toolCallsObjectKey
				: null,
		meta:
			record.meta &&
			typeof record.meta === "object" &&
			!Array.isArray(record.meta)
				? (record.meta as Record<string, unknown>)
				: null,
		createdAt:
			typeof record.createdAt === "string" ? record.createdAt : undefined,
	};
}

function parsePersistedState(raw: string): SessionGenerationState | null {
	try {
		const parsed = JSON.parse(raw) as Partial<PersistedGenerationState>;
		if (parsed.version !== STORAGE_VERSION) return null;
		if (parsed.userKey !== getUserKey()) return null;
		if (!parsed.sessionId || typeof parsed.sessionId !== "string") return null;
		if (!parsed.status || typeof parsed.status !== "string") return null;
		if (TERMINAL_STATUSES.has(parsed.status)) return null;
		const state: SessionGenerationState = {
			spaceId: typeof parsed.spaceId === "string" ? parsed.spaceId : null,
			sessionId: parsed.sessionId,
			status: parsed.status,
			requestId: typeof parsed.requestId === "string" ? parsed.requestId : null,
			error: sanitizeError(parsed.error),
			startedAt:
				typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
			lastEventAt:
				typeof parsed.lastEventAt === "number" ? parsed.lastEventAt : undefined,
			contentBlocks: Array.isArray(parsed.contentBlocks)
				? (parsed.contentBlocks as ContentBlock[])
				: [],
			intermediateMessages: Array.isArray(parsed.intermediateMessages)
				? parsed.intermediateMessages
						.map(parseIntermediateMessage)
						.filter((message): message is StreamingIntermediateMessage =>
							Boolean(message),
						)
				: [],
			streamMessageId:
				typeof parsed.streamMessageId === "string"
					? parsed.streamMessageId
					: null,
			messageOrdinal:
				typeof parsed.messageOrdinal === "number"
					? parsed.messageOrdinal
					: null,
			anchorUserMessageId:
				typeof parsed.anchorUserMessageId === "string"
					? parsed.anchorUserMessageId
					: null,
			truncatedStart: Boolean(parsed.truncatedStart),
			patchSeq: typeof parsed.patchSeq === "number" ? parsed.patchSeq : 0,
			turnId: typeof parsed.turnId === "string" ? parsed.turnId : null,
			finalizedPreview: Boolean(parsed.finalizedPreview),
		};
		return isFresh(state) ? state : null;
	} catch {
		return null;
	}
}

class SessionGenerationStore {
	bySessionId = $state<Record<string, SessionGenerationState>>({});
	private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor() {
		this.restorePersisted();
	}

	private restorePersisted() {
		const storage = getStorage();
		if (!storage) return;
		const restored: Record<string, SessionGenerationState> = {};
		const staleKeys: string[] = [];
		const keyPrefix = `${STORAGE_PREFIX}:${getUserKey()}:`;
		try {
			for (let i = 0; i < storage.length; i += 1) {
				const key = storage.key(i);
				if (!key?.startsWith(keyPrefix)) continue;
				const raw = storage.getItem(key);
				const state = raw ? parsePersistedState(raw) : null;
				if (!state) {
					staleKeys.push(key);
					continue;
				}
				restored[state.sessionId] = state;
			}
			for (const key of staleKeys) storage.removeItem(key);
			if (Object.keys(restored).length > 0) this.bySessionId = restored;
		} catch {
			// ignore persistence failures
		}
	}

	private clearPersistTimer(sessionId: string) {
		const timer = this.persistTimers.get(sessionId);
		if (!timer) return;
		clearTimeout(timer);
		this.persistTimers.delete(sessionId);
	}

	private clearPersisted(sessionId: string) {
		this.clearPersistTimer(sessionId);
		const storage = getStorage();
		if (!storage) return;
		try {
			storage.removeItem(storageKey(sessionId));
		} catch {
			// ignore
		}
	}

	private schedulePersist(state: SessionGenerationState) {
		if (!isPersistable(state)) {
			this.clearPersisted(state.sessionId);
			return;
		}
		this.clearPersistTimer(state.sessionId);
		const timer = setTimeout(() => {
			this.persistTimers.delete(state.sessionId);
			const storage = getStorage();
			if (!storage) return;
			try {
				const payload: PersistedGenerationState = {
					...state,
					userKey: getUserKey(),
					version: STORAGE_VERSION,
					error: sanitizeError(state.error),
				};
				storage.setItem(storageKey(state.sessionId), JSON.stringify(payload));
			} catch {
				// localStorage can be full or unavailable; runtime state remains source of truth.
			}
		}, STORAGE_WRITE_DEBOUNCE_MS);
		this.persistTimers.set(state.sessionId, timer);
	}

	private setState(sessionId: string, state: SessionGenerationState) {
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: state,
		};
		this.schedulePersist(state);
	}

	get(sessionId: string | null | undefined): SessionGenerationState | null {
		if (!sessionId) return null;
		return this.bySessionId[sessionId] ?? null;
	}

	isStreaming(sessionId: string | null | undefined): boolean {
		if (!sessionId) return false;
		const state = this.bySessionId[sessionId];
		return state?.status === "streaming";
	}

	isGenerating(sessionId: string | null | undefined): boolean {
		if (!sessionId) return false;
		const state = this.bySessionId[sessionId];
		return Boolean(state && !TERMINAL_STATUSES.has(state.status));
	}

	startPending(
		sessionId: string,
		input?: {
			requestId?: string | null;
			spaceId?: string | null;
			turnId?: string | null;
			finalizedPreview?: boolean;
		},
	) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		const isDifferentTurn = Boolean(
			input?.turnId && current.turnId && input.turnId !== current.turnId,
		);
		if (current.status === "streaming" && !isDifferentTurn) return;
		this.setState(sessionId, {
			...current,
			sessionId,
			spaceId: input?.spaceId ?? current.spaceId ?? null,
			status: "pending",
			requestId: input?.requestId ?? current.requestId ?? null,
			error: null,
			startedAt: current.startedAt ?? Date.now(),
			lastEventAt: Date.now(),
			contentBlocks: [],
			intermediateMessages: [],
			streamMessageId: null,
			messageOrdinal: null,
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: 0,
			turnId: input?.turnId ?? null,
			finalizedPreview: false,
		});
	}

	resumePending(
		sessionId: string,
		input?: {
			spaceId?: string | null;
			turnId?: string | null;
			anchorUserMessageId?: string | null;
		},
	) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		if (current.status === "streaming") return;
		if (isPersistable(current)) return;
		this.setState(sessionId, {
			...current,
			sessionId,
			spaceId: input?.spaceId ?? current.spaceId ?? null,
			status: "pending",
			error: null,
			startedAt: current.startedAt ?? Date.now(),
			lastEventAt: Date.now(),
			anchorUserMessageId:
				input?.anchorUserMessageId ?? current.anchorUserMessageId ?? null,
			turnId: input?.turnId ?? current.turnId ?? null,
			finalizedPreview:
				input?.finalizedPreview ?? current.finalizedPreview ?? false,
		});
	}

	applyProgress(
		sessionId: string,
		input: {
			spaceId?: string | null;
			contentBlocks: ContentBlock[];
			intermediateMessages?: StreamingIntermediateMessage[];
			streamMessageId?: string | null;
			messageOrdinal?: number | null;
			anchorUserMessageId?: string | null;
			truncatedStart?: boolean;
			patchSeq?: number;
			turnId?: string | null;
			finalizedPreview?: boolean;
		},
	) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.setState(sessionId, {
			...current,
			spaceId: input.spaceId ?? current.spaceId ?? null,
			status: "streaming",
			error: null,
			startedAt: current.startedAt ?? Date.now(),
			lastEventAt: Date.now(),
			contentBlocks: input.contentBlocks,
			intermediateMessages:
				input.intermediateMessages ?? current.intermediateMessages ?? [],
			streamMessageId:
				input.streamMessageId !== undefined
					? input.streamMessageId
					: current.streamMessageId,
			messageOrdinal:
				input.messageOrdinal !== undefined
					? input.messageOrdinal
					: current.messageOrdinal,
			anchorUserMessageId:
				input.anchorUserMessageId ?? current.anchorUserMessageId ?? null,
			truncatedStart: input.truncatedStart ?? current.truncatedStart,
			patchSeq: input.patchSeq ?? current.patchSeq,
			turnId: input.turnId ?? current.turnId ?? null,
			finalizedPreview: input.finalizedPreview ?? false,
		});
	}

	replaceTurnId(
		sessionId: string,
		input: { previousTurnId?: string | null; nextTurnId: string | null },
	) {
		const current = this.get(sessionId);
		if (!current) return;
		if (
			input.previousTurnId &&
			current.turnId &&
			current.turnId !== input.previousTurnId
		) {
			return;
		}
		this.setState(sessionId, {
			...current,
			turnId: input.nextTurnId,
			streamMessageId:
				current.streamMessageId && current.turnId && input.nextTurnId
					? current.streamMessageId.replace(
							`turn:${current.turnId}:`,
							`turn:${input.nextTurnId}:`,
						)
					: current.streamMessageId,
		});
	}

	complete(sessionId: string) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.setState(sessionId, {
			...current,
			status: "completed",
			error: null,
			lastEventAt: Date.now(),
			contentBlocks: [],
			intermediateMessages: [],
			streamMessageId: null,
			messageOrdinal: null,
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: current.patchSeq,
			turnId: current.turnId,
			finalizedPreview: false,
		});
	}

	fail(sessionId: string, error?: string | null) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.setState(sessionId, {
			...current,
			status: "failed",
			error: sanitizeError(error ?? current.error),
			lastEventAt: Date.now(),
			contentBlocks: [],
			intermediateMessages: [],
			streamMessageId: null,
			messageOrdinal: null,
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: current.patchSeq,
			turnId: current.turnId,
			finalizedPreview: false,
		});
	}

	interrupt(sessionId: string) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
		this.setState(sessionId, {
			...current,
			status: "interrupted",
			error: null,
			lastEventAt: Date.now(),
			contentBlocks: [],
			intermediateMessages: [],
			streamMessageId: null,
			messageOrdinal: null,
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: current.patchSeq,
			turnId: current.turnId,
			finalizedPreview: false,
		});
	}

	clearError(sessionId: string | null | undefined) {
		if (!sessionId) return;
		const current = this.get(sessionId);
		if (!current?.error) return;
		this.setState(sessionId, {
			...current,
			error: null,
		});
	}

	reset(sessionId: string | null | undefined) {
		if (!sessionId) return;
		this.bySessionId = {
			...this.bySessionId,
			[sessionId]: createIdleState(sessionId),
		};
		this.clearPersisted(sessionId);
	}

	resetAll() {
		for (const sessionId of Object.keys(this.bySessionId)) {
			this.clearPersisted(sessionId);
		}
		for (const timer of this.persistTimers.values()) clearTimeout(timer);
		this.persistTimers.clear();
		this.bySessionId = {};
	}
}

export const sessionGenerationStore = new SessionGenerationStore();
