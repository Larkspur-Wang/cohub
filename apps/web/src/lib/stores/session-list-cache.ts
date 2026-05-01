import type { SessionRecord } from "@neta-art/cohub";
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
): Promise<SessionRecord[]> {
	const snapshot = await sessionListRepo.setRecent(spaceId, sessions, pageInfo);
	return snapshot.sessions;
}

export async function patchCachedSessionList(
	spaceId: string,
	updater: (sessions: SessionRecord[]) => SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
): Promise<SessionRecord[]> {
	const snapshot = await sessionListRepo.patchRecent(
		spaceId,
		updater,
		pageInfo,
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
			pageInfo: SessionListPageInfo;
		}>;
		if (!custom.detail?.spaceId) return;
		handler({ ...custom.detail, pageInfo: custom.detail.pageInfo });
	};
	if (typeof window !== "undefined")
		window.addEventListener("cohub:session-list-cache-updated", listener);
	return () => {
		for (const unsubscribe of unsubscribers.values()) unsubscribe();
		if (typeof window !== "undefined")
			window.removeEventListener("cohub:session-list-cache-updated", listener);
	};
}

export async function fetchSessionListWithCache(
	spaceId: string,
	fetcher: () => Promise<SessionRecord[]>,
	options?: { force?: boolean },
): Promise<SessionRecord[]> {
	if (!options?.force) {
		const cached = await sessionListRepo.getRecent(spaceId);
		if (cached && !cached.stale) return cached.sessions;
	}
	const snapshot = await sessionListRepo.refreshRecent(spaceId, async () => ({
		sessions: await fetcher(),
		pageInfo: DEFAULT_SESSION_LIST_PAGE_INFO,
	}));
	return snapshot.sessions;
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
	const snapshot = await sessionListRepo.setRecent(
		spaceId,
		result.sessions,
		result.pageInfo ?? DEFAULT_SESSION_LIST_PAGE_INFO,
	);
	return { sessions: snapshot.sessions, pageInfo: snapshot.pageInfo };
}

export type { SessionListPageInfo };
