import type { UserSessionListItem } from "@neta-art/cohub";
import { idbDelete, idbGet, idbPut } from "$lib/cache/db";
import {
	canUseUserScopedCache,
	getCacheUserKeyAsync,
	userSessionListKey,
} from "$lib/cache/keys";
import {
	DEFAULT_SESSION_LIST_PAGE_INFO,
	type SessionListPageInfo,
} from "$lib/cache/types";
import { mergeSessionRecords } from "$lib/session-record-merge";
import { sortSessionsByRecentActivity } from "$lib/session-sort";

const STORE = "session_lists" as const;
const TTL_MS = 30_000;

type UserSessionListCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	kind: "recent";
	sessions: UserSessionListItem[];
	pageInfo: SessionListPageInfo;
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
	completeness: "partial" | "complete";
};

export type UserSessionListSnapshot = {
	sessions: UserSessionListItem[];
	pageInfo: SessionListPageInfo;
	updatedAt: number;
	stale: boolean;
};

const memory = new Map<string, UserSessionListCacheRecord>();
const listeners = new Set<(snapshot: UserSessionListSnapshot) => void>();

function normalizeSessions(sessions: UserSessionListItem[]) {
	return sortSessionsByRecentActivity(
		mergeSessionRecords(sessions),
	) as UserSessionListItem[];
}

function normalizePageInfo(
	pageInfo?: SessionListPageInfo | null,
): SessionListPageInfo {
	return {
		hasMore: Boolean(pageInfo?.hasMore),
		nextCursor: pageInfo?.nextCursor ?? null,
	};
}

function toSnapshot(
	record: UserSessionListCacheRecord,
): UserSessionListSnapshot {
	return {
		sessions: record.sessions,
		pageInfo: record.pageInfo,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt > TTL_MS,
	};
}

function publish(snapshot: UserSessionListSnapshot) {
	for (const listener of listeners) {
		try {
			listener(snapshot);
		} catch (error) {
			console.warn("[user-session-list-cache] listener failed", error);
		}
	}
}

async function resolveKey() {
	const userKey = await getCacheUserKeyAsync();
	if (!canUseUserScopedCache(userKey)) return null;
	return { userKey, key: userSessionListKey(userKey) };
}

export async function getCachedUserSessionListSnapshot(): Promise<UserSessionListSnapshot | null> {
	const resolved = await resolveKey();
	if (!resolved) return null;

	const memoryHit = memory.get(resolved.key);
	if (memoryHit) return toSnapshot(memoryHit);

	try {
		const record = await idbGet<UserSessionListCacheRecord>(
			STORE,
			resolved.key,
		);
		if (!record) return null;
		memory.set(resolved.key, record);
		return toSnapshot(record);
	} catch (error) {
		console.warn("[user-session-list-cache] Failed to read cache", error);
		return null;
	}
}

export async function setCachedUserSessionList(
	sessions: UserSessionListItem[],
	pageInfo?: SessionListPageInfo | null,
	options?: { mode?: "replace" | "merge"; expectedUserKey?: string | null },
): Promise<UserSessionListItem[]> {
	const resolved = await resolveKey();
	const nextSessions = normalizeSessions(sessions);
	if (!resolved) return nextSessions;
	// Drop stale writes if the signed-in user changed mid-flight.
	if (
		options?.expectedUserKey &&
		options.expectedUserKey !== resolved.userKey
	) {
		return nextSessions;
	}

	const current = memory.get(resolved.key) ?? null;
	const mergedSessions =
		options?.mode === "merge" && current
			? normalizeSessions([...current.sessions, ...nextSessions])
			: nextSessions;

	const record: UserSessionListCacheRecord = {
		key: resolved.key,
		userKey: resolved.userKey,
		// Reuse the space-scoped store schema with a sentinel space id.
		spaceId: "__user__",
		kind: "recent",
		sessions: mergedSessions,
		pageInfo: normalizePageInfo(pageInfo ?? current?.pageInfo),
		updatedAt: Date.now(),
		lastAccessedAt: Date.now(),
		watermark: mergedSessions[0]?.lastMessageAt ?? null,
		completeness: pageInfo?.hasMore ? "partial" : "complete",
	};

	memory.set(resolved.key, record);
	void idbPut(STORE, record).catch((error) => {
		console.warn("[user-session-list-cache] Failed to write cache", error);
	});
	publish(toSnapshot(record));
	return record.sessions;
}

export async function patchCachedUserSessionList(
	updater: (sessions: UserSessionListItem[]) => UserSessionListItem[],
	pageInfo?: SessionListPageInfo | null,
): Promise<UserSessionListItem[]> {
	const current = (await getCachedUserSessionListSnapshot())?.sessions ?? [];
	return setCachedUserSessionList(updater(current), pageInfo ?? null, {
		mode: "replace",
	});
}

export async function clearCachedUserSessionList() {
	const resolved = await resolveKey();
	if (!resolved) return;
	memory.delete(resolved.key);
	await idbDelete(STORE, resolved.key).catch(() => undefined);
}

export function onUserSessionListCacheUpdated(
	handler: (snapshot: UserSessionListSnapshot) => void,
) {
	listeners.add(handler);
	return () => {
		listeners.delete(handler);
	};
}

export function emptyUserSessionListPageInfo(): SessionListPageInfo {
	return { ...DEFAULT_SESSION_LIST_PAGE_INFO };
}
