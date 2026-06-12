import type { SessionRecord } from "@neta-art/cohub";
import type { SessionListForkRecord } from "$lib/cache/db";
import { deleteCacheDatabase } from "$lib/cache/db";
import { sessionListRepo } from "$lib/cache/repositories/session-list-repo";
import {
	DEFAULT_SESSION_LIST_PAGE_INFO,
	type SessionListPageInfo,
} from "$lib/cache/types";

export function getCachedSessionList(spaceId: string): SessionRecord[] | null {
	void spaceId;
	return null;
}

export function getCachedSessionListPageInfo(
	spaceId: string,
): SessionListPageInfo | null {
	void spaceId;
	return null;
}

export function getCachedSessionListMeta(spaceId: string) {
	void spaceId;
	return null;
}

export async function getCachedSessionListSnapshot(spaceId: string) {
	return sessionListRepo.getRecent(spaceId);
}

export async function setCachedSessionList(
	spaceId: string,
	sessions: SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
	forks?: SessionListForkRecord[] | null,
): Promise<SessionRecord[]> {
	const snapshot = await sessionListRepo.setRecent(
		spaceId,
		sessions,
		pageInfo,
		forks,
	);
	return snapshot.sessions;
}

export async function patchCachedSessionList(
	spaceId: string,
	updater: (sessions: SessionRecord[]) => SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
	forks?: SessionListForkRecord[] | null,
): Promise<SessionRecord[]> {
	const snapshot = await sessionListRepo.patchRecent(
		spaceId,
		updater,
		pageInfo,
		forks,
	);
	return snapshot.sessions;
}

export async function clearCachedSessionList(spaceId: string) {
	await sessionListRepo.deleteRecent(spaceId);
}

export async function clearAllCachedSessionLists() {
	await deleteCacheDatabase();
}

export function onSessionListCacheUpdated(
	handler: (event: {
		spaceId: string;
		sessions: SessionRecord[];
		forks: SessionListForkRecord[];
		pageInfo: SessionListPageInfo | null;
	}) => void,
) {
	const unsubscribers = new Map<string, () => void>();
	// Compatibility event stream is now driven by repository broadcasts. Since the
	// old API was global-by-space, expose a lightweight DOM bridge below.
	const listener = (event: Event) => {
		const custom = event as CustomEvent<{
			spaceId: string;
			sessions: SessionRecord[];
			forks?: SessionListForkRecord[];
			pageInfo: SessionListPageInfo;
		}>;
		if (!custom.detail?.spaceId) return;
		handler({
			...custom.detail,
			forks: custom.detail.forks ?? [],
			pageInfo: custom.detail.pageInfo,
		});
	};
	if (typeof window !== "undefined")
		window.addEventListener("cohub:session-list-cache-updated", listener);
	return () => {
		for (const unsubscribe of unsubscribers.values()) unsubscribe();
		if (typeof window !== "undefined")
			window.removeEventListener("cohub:session-list-cache-updated", listener);
	};
}

type SessionListCacheFetchResult =
	| SessionRecord[]
	| {
			sessions: SessionRecord[];
			forks?: SessionListForkRecord[] | null;
			pageInfo?: SessionListPageInfo | null;
	  };

function normalizeSessionListFetchResult(result: SessionListCacheFetchResult): {
	sessions: SessionRecord[];
	forks?: SessionListForkRecord[] | null;
	pageInfo?: SessionListPageInfo | null;
} {
	return Array.isArray(result) ? { sessions: result } : result;
}

const sessionListRefreshInFlight = new Map<string, Promise<SessionRecord[]>>();

function refreshSessionListCache(
	spaceId: string,
	fetcher: () => Promise<SessionListCacheFetchResult>,
): Promise<SessionRecord[]> {
	const inFlight = sessionListRefreshInFlight.get(spaceId);
	if (inFlight) return inFlight;

	const run = sessionListRepo
		.refreshRecent(spaceId, async () => {
			const result = normalizeSessionListFetchResult(await fetcher());
			return {
				sessions: result.sessions,
				forks: result.forks,
				pageInfo: result.pageInfo ?? DEFAULT_SESSION_LIST_PAGE_INFO,
			};
		})
		.then((snapshot) => snapshot.sessions)
		.finally(() => {
			if (sessionListRefreshInFlight.get(spaceId) === run) {
				sessionListRefreshInFlight.delete(spaceId);
			}
		});

	sessionListRefreshInFlight.set(spaceId, run);
	return run;
}

export async function fetchSessionListWithCache(
	spaceId: string,
	fetcher: () => Promise<SessionListCacheFetchResult>,
	options?: { force?: boolean },
): Promise<SessionRecord[]> {
	const cached = !options?.force
		? await sessionListRepo.getRecent(spaceId).catch(() => null)
		: null;
	if (cached) {
		void refreshSessionListCache(spaceId, fetcher).catch(() => undefined);
		return cached.sessions;
	}
	return refreshSessionListCache(spaceId, fetcher);
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
	const snapshot = await sessionListRepo.patchRecent(
		spaceId,
		() => result.sessions,
		result.pageInfo ?? DEFAULT_SESSION_LIST_PAGE_INFO,
	);
	return { sessions: snapshot.sessions, pageInfo: snapshot.pageInfo };
}

export type { SessionListPageInfo };
