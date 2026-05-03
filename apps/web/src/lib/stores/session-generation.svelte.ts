import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { authStore } from "$lib/stores/auth.svelte";

export type SessionGenerationStatus =
	| "idle"
	| "pending"
	| "streaming"
	| "completed"
	| "failed";

export type SessionGenerationState = {
	spaceId?: string | null;
	sessionId: string;
	status: SessionGenerationStatus | string;
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
	anchorUserMessageId: null,
	truncatedStart: false,
	patchSeq: 0,
	turnId: null,
});

function getStorage(): Storage | null {
	return typeof globalThis.localStorage === "undefined"
		? null
		: globalThis.localStorage;
}

function getUserKey() {
	return authStore.userUuid ?? authStore.claims?.sub ?? "guest";
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
			anchorUserMessageId:
				typeof parsed.anchorUserMessageId === "string"
					? parsed.anchorUserMessageId
					: null,
			truncatedStart: Boolean(parsed.truncatedStart),
			patchSeq: typeof parsed.patchSeq === "number" ? parsed.patchSeq : 0,
			turnId: typeof parsed.turnId === "string" ? parsed.turnId : null,
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
		return Boolean(state && !TERMINAL_STATUSES.has(state.status));
	}

	startPending(
		sessionId: string,
		input?: {
			requestId?: string | null;
			spaceId?: string | null;
			turnId?: string | null;
		},
	) {
		const current = this.get(sessionId) ?? createIdleState(sessionId);
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
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: 0,
			turnId: input?.turnId ?? null,
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
		});
	}

	applyProgress(
		sessionId: string,
		input: {
			spaceId?: string | null;
			contentBlocks: ContentBlock[];
			anchorUserMessageId?: string | null;
			truncatedStart?: boolean;
			patchSeq?: number;
			turnId?: string | null;
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
			anchorUserMessageId:
				input.anchorUserMessageId ?? current.anchorUserMessageId ?? null,
			truncatedStart: input.truncatedStart ?? current.truncatedStart,
			patchSeq: input.patchSeq ?? current.patchSeq,
			turnId: input.turnId ?? current.turnId ?? null,
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
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: current.patchSeq,
			turnId: current.turnId,
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
			anchorUserMessageId: null,
			truncatedStart: false,
			patchSeq: current.patchSeq,
			turnId: current.turnId,
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
