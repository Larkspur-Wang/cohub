import type { SessionRecord } from "@neta-art/cohub";
import { authStore } from "$lib/stores/auth.svelte";

const STORAGE_PREFIX = "cohub:session-list";
const CACHE_VERSION = 1;
const SESSION_LIST_UPDATED_EVENT = "cohub:session-list-updated";

type SessionListCacheEntry = {
	version: number;
	spaceId: string;
	userKey: string;
	updatedAt: number;
	data: SessionRecord[];
};

const memoryCache = new Map<string, SessionListCacheEntry>();
const inflightByScope = new Map<string, Promise<SessionRecord[]>>();

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getUserKey() {
	return authStore.userUuid ?? authStore.claims?.sub ?? "guest";
}

function getScopeKey(spaceId: string) {
	return `${getUserKey()}:${spaceId}`;
}

function getStorageKey(spaceId: string) {
	return `${STORAGE_PREFIX}:${getUserKey()}:${spaceId}:v${CACHE_VERSION}`;
}

function sortSessions(sessions: SessionRecord[]) {
	return [...sessions].sort((a, b) => {
		const aTime = new Date(a.updatedAt ?? a.createdAt).getTime();
		const bTime = new Date(b.updatedAt ?? b.createdAt).getTime();
		return bTime - aTime;
	});
}

function dedupeSessions(sessions: SessionRecord[]) {
	const byId = new Map<string, SessionRecord>();
	for (const session of sessions) {
		byId.set(session.id, session);
	}
	return sortSessions(Array.from(byId.values()));
}

function toEntry(
	spaceId: string,
	sessions: SessionRecord[],
): SessionListCacheEntry {
	return {
		version: CACHE_VERSION,
		spaceId,
		userKey: getUserKey(),
		updatedAt: Date.now(),
		data: dedupeSessions(sessions),
	};
}

function emitSessionListUpdated(spaceId: string, sessions: SessionRecord[]) {
	if (!isBrowser()) return;
	window.dispatchEvent(
		new CustomEvent(SESSION_LIST_UPDATED_EVENT, {
			detail: {
				spaceId,
				sessions,
			},
		}),
	);
}

export function getCachedSessionList(spaceId: string): SessionRecord[] | null {
	const scopeKey = getScopeKey(spaceId);
	const memory = memoryCache.get(scopeKey);
	if (memory) {
		return memory.data;
	}
	if (!isBrowser()) return null;

	try {
		const raw = localStorage.getItem(getStorageKey(spaceId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as SessionListCacheEntry;
		if (
			parsed.version !== CACHE_VERSION ||
			parsed.spaceId !== spaceId ||
			!Array.isArray(parsed.data)
		) {
			localStorage.removeItem(getStorageKey(spaceId));
			return null;
		}
		const normalized = toEntry(spaceId, parsed.data);
		memoryCache.set(scopeKey, normalized);
		return normalized.data;
	} catch {
		try {
			localStorage.removeItem(getStorageKey(spaceId));
		} catch {
			// ignore
		}
		return null;
	}
}

export function setCachedSessionList(
	spaceId: string,
	sessions: SessionRecord[],
): SessionRecord[] {
	const entry = toEntry(spaceId, sessions);
	memoryCache.set(getScopeKey(spaceId), entry);
	if (isBrowser()) {
		try {
			localStorage.setItem(getStorageKey(spaceId), JSON.stringify(entry));
		} catch {
			// ignore
		}
	}
	emitSessionListUpdated(spaceId, entry.data);
	return entry.data;
}

export function patchCachedSessionList(
	spaceId: string,
	updater: (sessions: SessionRecord[]) => SessionRecord[],
): SessionRecord[] {
	const current = getCachedSessionList(spaceId) ?? [];
	return setCachedSessionList(spaceId, updater(current));
}

export function clearCachedSessionList(spaceId: string) {
	memoryCache.delete(getScopeKey(spaceId));
	if (!isBrowser()) return;
	try {
		localStorage.removeItem(getStorageKey(spaceId));
	} catch {
		// ignore
	}
}

export function onSessionListCacheUpdated(
	handler: (event: { spaceId: string; sessions: SessionRecord[] }) => void,
) {
	if (!isBrowser()) return () => {};

	const listener = (event: Event) => {
		const custom = event as CustomEvent<{
			spaceId?: string;
			sessions?: SessionRecord[];
		}>;
		if (!custom.detail?.spaceId || !Array.isArray(custom.detail.sessions))
			return;
		handler({
			spaceId: custom.detail.spaceId,
			sessions: custom.detail.sessions,
		});
	};

	window.addEventListener(
		SESSION_LIST_UPDATED_EVENT,
		listener as EventListener,
	);
	return () =>
		window.removeEventListener(
			SESSION_LIST_UPDATED_EVENT,
			listener as EventListener,
		);
}

export async function fetchSessionListWithCache(
	spaceId: string,
	fetcher: () => Promise<SessionRecord[]>,
	options?: { force?: boolean },
): Promise<SessionRecord[]> {
	const scopeKey = getScopeKey(spaceId);
	if (!options?.force) {
		const inflight = inflightByScope.get(scopeKey);
		if (inflight) return inflight;
	}

	const request = (async () => {
		const sessions = await fetcher();
		return setCachedSessionList(spaceId, sessions);
	})().finally(() => {
		if (inflightByScope.get(scopeKey) === request) {
			inflightByScope.delete(scopeKey);
		}
	});

	inflightByScope.set(scopeKey, request);
	return request;
}
