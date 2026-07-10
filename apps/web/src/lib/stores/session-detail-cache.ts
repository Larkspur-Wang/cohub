import type { SessionRecord } from "@neta-art/cohub";
import { canUseUserScopedCache, getCacheUserKeyAsync } from "$lib/cache/keys";
import { sessionDetailRepo } from "$lib/cache/repositories/session-detail-repo";

const refreshInFlight = new Map<string, Promise<SessionRecord>>();

function cacheKey(spaceId: string, sessionId: string) {
	return `${spaceId}:${sessionId}`;
}

async function resolveCacheUserKey() {
	const userKey = await getCacheUserKeyAsync();
	return canUseUserScopedCache(userKey) ? userKey : null;
}

async function requireCacheUserKey() {
	const userKey = await resolveCacheUserKey();
	if (!userKey) {
		throw new Error("user-scoped cache unavailable until identity is resolved");
	}
	return userKey;
}

export async function getCachedSessionDetailSnapshot(
	spaceId: string,
	sessionId: string,
) {
	if (!(await resolveCacheUserKey())) return null;
	return sessionDetailRepo.get(spaceId, sessionId);
}

export async function getCachedSessionDetails(
	spaceId: string,
	sessionIds: string[],
) {
	if (!(await resolveCacheUserKey())) return {};
	return sessionDetailRepo.getMany(spaceId, sessionIds);
}

export async function setCachedSessionDetail(
	spaceId: string,
	session: SessionRecord,
) {
	await requireCacheUserKey();
	return sessionDetailRepo.set(spaceId, session);
}

export async function setCachedSessionDetails(
	spaceId: string,
	sessions: SessionRecord[],
) {
	await requireCacheUserKey();
	return sessionDetailRepo.setMany(spaceId, sessions);
}

export async function fetchSessionDetailWithCache(
	spaceId: string,
	sessionId: string,
	fetcher: () => Promise<SessionRecord>,
	options?: { force?: boolean },
): Promise<SessionRecord> {
	await requireCacheUserKey();
	const cached = !options?.force
		? await sessionDetailRepo.get(spaceId, sessionId).catch(() => null)
		: null;
	if (cached) {
		if (cached.stale) {
			void sessionDetailRepo
				.refresh(spaceId, sessionId, fetcher)
				.catch(() => undefined);
		}
		return cached.session;
	}

	const key = cacheKey(spaceId, sessionId);
	const pending = refreshInFlight.get(key);
	if (pending) return pending;
	const run = sessionDetailRepo
		.refresh(spaceId, sessionId, fetcher)
		.then((snapshot) => snapshot.session)
		.finally(() => {
			if (refreshInFlight.get(key) === run) refreshInFlight.delete(key);
		});
	refreshInFlight.set(key, run);
	return run;
}

export function onSessionDetailCacheUpdated(
	spaceId: string,
	sessionId: string,
	handler: (session: SessionRecord) => void,
) {
	return sessionDetailRepo.subscribe(spaceId, sessionId, (snapshot) => {
		handler(snapshot.session);
	});
}
