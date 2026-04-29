import type { SessionRecord } from "@neta-art/cohub";
import { authStore } from "$lib/stores/auth.svelte";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";

const SESSION_LIST_SCOPE_SEPARATOR = "::";
const SESSION_LIST_SCOPE_ALL = "all";
const SESSION_PAGE_INFO_STORAGE_PREFIX = "cohub:session-list-page-info";
const SESSION_PAGE_INFO_CACHE_VERSION = 1;

type SessionListPageInfo = { hasMore: boolean; nextCursor: string | null };

const DEFAULT_SESSION_PAGE_INFO: SessionListPageInfo = {
	hasMore: false,
	nextCursor: null,
};

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

const cache = createLocalListCache<SessionRecord>({
	storagePrefix: "cohub:session-list",
	cacheVersion: 2,
	updatedEventName: "cohub:session-list-updated",
	ttlMs: 30_000,
	normalize: dedupeSessions,
});

function getScope(spaceId: string) {
	return `${spaceId}${SESSION_LIST_SCOPE_SEPARATOR}${SESSION_LIST_SCOPE_ALL}`;
}

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function getUserKey() {
	return authStore.userUuid ?? authStore.claims?.sub ?? "guest";
}

function getPageInfoStorageKey(scope: string) {
	return `${SESSION_PAGE_INFO_STORAGE_PREFIX}:${getUserKey()}:${scope}:v${SESSION_PAGE_INFO_CACHE_VERSION}`;
}

function normalizePageInfo(
	pageInfo: SessionListPageInfo | null | undefined,
): SessionListPageInfo {
	return {
		hasMore: Boolean(pageInfo?.hasMore),
		nextCursor: pageInfo?.nextCursor ?? null,
	};
}

function setCachedPageInfo(scope: string, pageInfo: SessionListPageInfo) {
	if (!isBrowser()) return;
	try {
		localStorage.setItem(
			getPageInfoStorageKey(scope),
			JSON.stringify(normalizePageInfo(pageInfo)),
		);
	} catch {
		// ignore
	}
}

function getCachedPageInfo(scope: string): SessionListPageInfo | null {
	if (!isBrowser()) return null;
	try {
		const raw = localStorage.getItem(getPageInfoStorageKey(scope));
		if (!raw) return null;
		return normalizePageInfo(JSON.parse(raw) as SessionListPageInfo);
	} catch {
		try {
			localStorage.removeItem(getPageInfoStorageKey(scope));
		} catch {
			// ignore
		}
		return null;
	}
}

function clearCachedPageInfo(scope: string) {
	if (!isBrowser()) return;
	try {
		localStorage.removeItem(getPageInfoStorageKey(scope));
	} catch {
		// ignore
	}
}

function clearAllCachedPageInfoForCurrentUser() {
	if (!isBrowser()) return;
	try {
		const prefix = `${SESSION_PAGE_INFO_STORAGE_PREFIX}:${getUserKey()}:`;
		for (let i = localStorage.length - 1; i >= 0; i -= 1) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) localStorage.removeItem(key);
		}
	} catch {
		// ignore
	}
}

export function getCachedSessionList(spaceId: string): SessionRecord[] | null {
	return cache.getCached(getScope(spaceId));
}

export function getCachedSessionListPageInfo(
	spaceId: string,
): SessionListPageInfo | null {
	return getCachedPageInfo(getScope(spaceId));
}

export function getCachedSessionListMeta(spaceId: string) {
	return cache.getCachedMeta(getScope(spaceId));
}

export function setCachedSessionList(
	spaceId: string,
	sessions: SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
): SessionRecord[] {
	const scope = getScope(spaceId);
	if (pageInfo !== undefined)
		setCachedPageInfo(scope, pageInfo ?? DEFAULT_SESSION_PAGE_INFO);
	return cache.setCached(scope, sessions);
}

export function patchCachedSessionList(
	spaceId: string,
	updater: (sessions: SessionRecord[]) => SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
): SessionRecord[] {
	const scope = getScope(spaceId);
	if (pageInfo !== undefined)
		setCachedPageInfo(scope, pageInfo ?? DEFAULT_SESSION_PAGE_INFO);
	return cache.patchCached(scope, updater);
}

export function clearCachedSessionList(spaceId: string) {
	const scope = getScope(spaceId);
	cache.clearCached(scope);
	clearCachedPageInfo(scope);
}

export function clearAllCachedSessionLists() {
	cache.clearAllForCurrentUser();
	clearAllCachedPageInfoForCurrentUser();
}

export function onSessionListCacheUpdated(
	handler: (event: {
		spaceId: string;
		sessions: SessionRecord[];
		pageInfo: SessionListPageInfo | null;
	}) => void,
) {
	return cache.onUpdated(({ scope, data }) => {
		const [spaceId] = scope.split(SESSION_LIST_SCOPE_SEPARATOR);
		if (!spaceId) return;
		handler({ spaceId, sessions: data, pageInfo: getCachedPageInfo(scope) });
	});
}

export async function fetchSessionListWithCache(
	spaceId: string,
	fetcher: () => Promise<SessionRecord[]>,
	options?: { force?: boolean },
): Promise<SessionRecord[]> {
	return cache.fetchWithCache(getScope(spaceId), fetcher, options);
}

export async function fetchSessionListWithPageInfoCache(
	spaceId: string,
	fetcher: () => Promise<{
		sessions: SessionRecord[];
		pageInfo?: SessionListPageInfo;
	}>,
	_options?: { force?: boolean },
): Promise<{ sessions: SessionRecord[]; pageInfo: SessionListPageInfo }> {
	const result = await fetcher();
	const pageInfo = result.pageInfo ?? DEFAULT_SESSION_PAGE_INFO;
	const sessions = setCachedSessionList(spaceId, result.sessions, pageInfo);
	return { sessions, pageInfo };
}

export type { SessionListPageInfo };
