import type { SessionRecord } from "@neta-art/cohub";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";

const SESSION_LIST_SCOPE_SEPARATOR = "::";
const SESSION_LIST_SCOPE_ALL = "all";

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

export function getCachedSessionList(spaceId: string): SessionRecord[] | null {
	return cache.getCached(getScope(spaceId));
}

export function getCachedSessionListMeta(spaceId: string) {
	return cache.getCachedMeta(getScope(spaceId));
}

export function setCachedSessionList(
	spaceId: string,
	sessions: SessionRecord[],
): SessionRecord[] {
	return cache.setCached(getScope(spaceId), sessions);
}

export function patchCachedSessionList(
	spaceId: string,
	updater: (sessions: SessionRecord[]) => SessionRecord[],
): SessionRecord[] {
	return cache.patchCached(getScope(spaceId), updater);
}

export function clearCachedSessionList(spaceId: string) {
	cache.clearCached(getScope(spaceId));
}

export function clearAllCachedSessionLists() {
	cache.clearAllForCurrentUser();
}

export function onSessionListCacheUpdated(
	handler: (event: { spaceId: string; sessions: SessionRecord[] }) => void,
) {
	return cache.onUpdated(({ scope, data }) => {
		const [spaceId] = scope.split(SESSION_LIST_SCOPE_SEPARATOR);
		if (!spaceId) return;
		handler({ spaceId, sessions: data });
	});
}

export async function fetchSessionListWithCache(
	spaceId: string,
	fetcher: () => Promise<SessionRecord[]>,
	options?: { force?: boolean },
): Promise<SessionRecord[]> {
	return cache.fetchWithCache(getScope(spaceId), fetcher, options);
}
