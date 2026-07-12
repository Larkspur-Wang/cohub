import type { UserSessionListItem } from "@neta-art/cohub";
import { getCacheUserKeyAsync } from "$lib/cache/keys";
import { sdk } from "$lib/sdk";
import { mergeSessionRecord } from "$lib/session-record-merge";
import { sortSessionsByRecentActivity } from "$lib/session-sort";
import {
	emptyUserSessionListPageInfo,
	getCachedUserSessionListSnapshot,
	onUserSessionListCacheUpdated,
	setCachedUserSessionList,
} from "$lib/stores/user-session-list-cache";

const PAGE_SIZE = 30;

export function createUserSessionListController() {
	let sessions = $state<UserSessionListItem[]>([]);
	let pageInfo = $state(emptyUserSessionListPageInfo());
	let loading = $state(false);
	let loadingMore = $state(false);
	let refreshing = $state(false);
	let error = $state<string | null>(null);
	let hydrated = $state(false);
	let refreshSeq = 0;
	let loadMoreSeq = 0;

	function applySnapshot(next: {
		sessions: UserSessionListItem[];
		pageInfo?: { hasMore: boolean; nextCursor: string | null } | null;
	}) {
		sessions = sortSessionsByRecentActivity(
			next.sessions,
		) as UserSessionListItem[];
		if (next.pageInfo) {
			pageInfo = {
				hasMore: Boolean(next.pageInfo.hasMore),
				nextCursor: next.pageInfo.nextCursor ?? null,
			};
		}
	}

	async function hydrateFromCache() {
		const cached = await getCachedUserSessionListSnapshot().catch(() => null);
		if (cached?.sessions.length) {
			applySnapshot(cached);
		}
		hydrated = true;
		return cached;
	}

	async function refresh(options?: { force?: boolean }) {
		if (refreshing && !options?.force) return;
		const seq = ++refreshSeq;
		const requestUserKey = await getCacheUserKeyAsync();
		const shouldShowLoading = sessions.length === 0;
		if (shouldShowLoading) loading = true;
		else refreshing = true;
		error = null;
		try {
			const result = await sdk.user.listSessions({
				limit: PAGE_SIZE,
				cursor: null,
			});
			if (seq !== refreshSeq) return;
			const currentUserKey = await getCacheUserKeyAsync();
			if (currentUserKey !== requestUserKey) return;

			const nextSessions = (result.sessions ?? []) as UserSessionListItem[];
			const nextPageInfo = result.pageInfo ?? emptyUserSessionListPageInfo();
			applySnapshot({ sessions: nextSessions, pageInfo: nextPageInfo });
			await setCachedUserSessionList(nextSessions, nextPageInfo, {
				mode: "replace",
				expectedUserKey: requestUserKey,
			});
		} catch (err) {
			if (seq !== refreshSeq) return;
			console.warn("[user-sessions] Failed to refresh list", err);
			if (sessions.length === 0) {
				error = err instanceof Error ? err.message : "Failed to load sessions";
			}
		} finally {
			if (seq === refreshSeq) {
				loading = false;
				refreshing = false;
				hydrated = true;
			}
		}
	}

	async function loadMore() {
		if (loadingMore || !pageInfo.hasMore || !pageInfo.nextCursor) return;
		const seq = ++loadMoreSeq;
		const requestUserKey = await getCacheUserKeyAsync();
		const cursor = pageInfo.nextCursor;
		loadingMore = true;
		error = null;
		try {
			const result = await sdk.user.listSessions({
				limit: PAGE_SIZE,
				cursor,
			});
			if (seq !== loadMoreSeq) return;
			const currentUserKey = await getCacheUserKeyAsync();
			if (currentUserKey !== requestUserKey) return;

			const more = (result.sessions ?? []) as UserSessionListItem[];
			const nextPageInfo = result.pageInfo ?? emptyUserSessionListPageInfo();
			const byId = new Map(sessions.map((session) => [session.id, session]));
			for (const session of more) {
				byId.set(
					session.id,
					mergeSessionRecord(
						byId.get(session.id),
						session,
					) as UserSessionListItem,
				);
			}
			const merged = sortSessionsByRecentActivity([
				...byId.values(),
			]) as UserSessionListItem[];
			applySnapshot({ sessions: merged, pageInfo: nextPageInfo });
			await setCachedUserSessionList(merged, nextPageInfo, {
				mode: "replace",
				expectedUserKey: requestUserKey,
			});
		} catch (err) {
			if (seq !== loadMoreSeq) return;
			console.warn("[user-sessions] Failed to load more", err);
		} finally {
			if (seq === loadMoreSeq) loadingMore = false;
		}
	}

	function upsertSession(session: UserSessionListItem) {
		const existing = sessions.find((item) => item.id === session.id);
		const next = sortSessionsByRecentActivity([
			mergeSessionRecord(existing, session) as UserSessionListItem,
			...sessions.filter((item) => item.id !== session.id),
		]) as UserSessionListItem[];
		sessions = next;
		void setCachedUserSessionList(next, pageInfo, { mode: "replace" });
	}

	function findById(sessionId: string) {
		return sessions.find((session) => session.id === sessionId) ?? null;
	}

	function subscribeCache() {
		return onUserSessionListCacheUpdated((snapshot) => {
			applySnapshot(snapshot);
		});
	}

	return {
		get sessions() {
			return sessions;
		},
		get pageInfo() {
			return pageInfo;
		},
		get loading() {
			return loading;
		},
		get loadingMore() {
			return loadingMore;
		},
		get refreshing() {
			return refreshing;
		},
		get error() {
			return error;
		},
		get hydrated() {
			return hydrated;
		},
		hydrateFromCache,
		refresh,
		loadMore,
		upsertSession,
		findById,
		subscribeCache,
	};
}
