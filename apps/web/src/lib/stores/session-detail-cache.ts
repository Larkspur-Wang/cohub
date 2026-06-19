import type { SessionRecord } from "@neta-art/cohub";
import { sessionDetailRepo } from "$lib/cache/repositories/session-detail-repo";

const refreshInFlight = new Map<string, Promise<SessionRecord>>();

function cacheKey(spaceId: string, sessionId: string) {
	return `${spaceId}:${sessionId}`;
}

export async function getCachedSessionDetailSnapshot(
	spaceId: string,
	sessionId: string,
) {
	return sessionDetailRepo.get(spaceId, sessionId);
}

export async function getCachedSessionDetails(
	spaceId: string,
	sessionIds: string[],
) {
	return sessionDetailRepo.getMany(spaceId, sessionIds);
}

export async function setCachedSessionDetail(
	spaceId: string,
	session: SessionRecord,
) {
	return sessionDetailRepo.set(spaceId, session);
}

export async function setCachedSessionDetails(
	spaceId: string,
	sessions: SessionRecord[],
) {
	return sessionDetailRepo.setMany(spaceId, sessions);
}

export async function fetchSessionDetailWithCache(
	spaceId: string,
	sessionId: string,
	fetcher: () => Promise<SessionRecord>,
	options?: { force?: boolean },
): Promise<SessionRecord> {
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
