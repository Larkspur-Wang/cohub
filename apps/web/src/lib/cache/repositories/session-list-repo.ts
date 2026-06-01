import type { SessionRecord } from "@neta-art/cohub";
import {
	publishCacheMessage,
	subscribeCacheMessages,
} from "$lib/cache/broadcast";
import type { SessionListForkRecord } from "$lib/cache/db";
import {
	idbDelete,
	idbGet,
	idbPut,
	type SessionListCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey, sessionListKey } from "$lib/cache/keys";
import { MemoryLru } from "$lib/cache/memory-lru";
import {
	type CacheSource,
	DEFAULT_SESSION_LIST_PAGE_INFO,
	type SessionListPageInfo,
} from "$lib/cache/types";
import { mergeSessionRecords } from "$lib/session-record-merge";
import { sortSessionsByRecentActivity } from "$lib/session-sort";

const SESSION_LIST_TTL_MS = 30_000;
const memory = new MemoryLru<string, SessionListCacheRecord>(50);
const listeners = new Set<
	(snapshot: SessionListSnapshot & { spaceId: string }) => void
>();
let subscribedToBroadcast = false;

type SessionListFetchResult = {
	sessions: SessionRecord[];
	forks?: SessionListForkRecord[] | null;
	pageInfo?: SessionListPageInfo | null;
};

export type SessionListSnapshot = {
	sessions: SessionRecord[];
	forks: SessionListForkRecord[];
	pageInfo: SessionListPageInfo;
	updatedAt: number;
	stale: boolean;
	source: CacheSource;
};

function normalizeSessions(sessions: SessionRecord[]) {
	return sortSessionsByRecentActivity(mergeSessionRecords(sessions));
}

function normalizePageInfo(
	pageInfo: SessionListPageInfo | null | undefined,
): SessionListPageInfo {
	return {
		hasMore: Boolean(pageInfo?.hasMore),
		nextCursor: pageInfo?.nextCursor ?? null,
	};
}

function toSnapshot(
	record: SessionListCacheRecord,
	source: CacheSource,
): SessionListSnapshot {
	return {
		sessions: record.sessions,
		forks: record.forks ?? [],
		pageInfo: record.pageInfo,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt >= SESSION_LIST_TTL_MS,
		source,
	};
}

async function readRecord(spaceId: string) {
	const userKey = getCacheUserKey();
	const key = sessionListKey(userKey, spaceId);
	const cached = memory.get(key);
	if (cached) return { record: cached, source: "memory" as CacheSource };
	const record = await idbGet<SessionListCacheRecord>("session_lists", key);
	if (!record) return null;
	const touched = { ...record, lastAccessedAt: Date.now() };
	memory.set(key, touched);
	void idbPut("session_lists", touched).catch(() => undefined);
	return { record: touched, source: "indexeddb" as CacheSource };
}

async function writeRecord(
	spaceId: string,
	sessions: SessionRecord[],
	pageInfo?: SessionListPageInfo | null,
	forks?: SessionListForkRecord[] | null,
	options?: { broadcast?: boolean; completeness?: "partial" | "complete" },
) {
	const userKey = getCacheUserKey();
	const key = sessionListKey(userKey, spaceId);
	const now = Date.now();
	const normalized = normalizeSessions(sessions);
	const record: SessionListCacheRecord = {
		key,
		userKey,
		spaceId,
		kind: "recent",
		sessions: normalized,
		forks: forks ?? [],
		pageInfo: normalizePageInfo(pageInfo),
		updatedAt: now,
		lastAccessedAt: now,
		watermark: normalized[0]?.updatedAt ?? null,
		completeness: options?.completeness ?? "partial",
	};
	memory.set(key, record);
	await idbPut("session_lists", record);
	if (options?.broadcast !== false) {
		publishCacheMessage({
			type: "cache-updated",
			store: "session_lists",
			key,
			userKey,
			spaceId,
			updatedAt: now,
		});
	}
	emit(spaceId, toSnapshot(record, "indexeddb"));
	return record;
}

function emit(spaceId: string, snapshot: SessionListSnapshot) {
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("cohub:session-list-cache-updated", {
				detail: {
					spaceId,
					sessions: snapshot.sessions,
					forks: snapshot.forks,
					pageInfo: snapshot.pageInfo,
				},
			}),
		);
	}
	for (const listener of listeners) listener({ ...snapshot, spaceId });
}

function ensureBroadcastSubscription() {
	if (subscribedToBroadcast) return;
	subscribedToBroadcast = true;
	subscribeCacheMessages((message) => {
		if (message.store !== "session_lists" || !message.spaceId) return;
		if (message.userKey !== getCacheUserKey()) return;
		if (message.key) memory.delete(message.key);
		if (message.type === "cache-deleted") {
			emit(message.spaceId, {
				sessions: [],
				forks: [],
				pageInfo: DEFAULT_SESSION_LIST_PAGE_INFO,
				updatedAt: message.updatedAt,
				stale: true,
				source: "indexeddb",
			});
			return;
		}
		void readRecord(message.spaceId).then((result) => {
			if (result)
				emit(message.spaceId as string, toSnapshot(result.record, "indexeddb"));
		});
	});
}

export const sessionListRepo = {
	async getRecent(spaceId: string) {
		ensureBroadcastSubscription();
		const result = await readRecord(spaceId);
		return result ? toSnapshot(result.record, result.source) : null;
	},

	async refreshRecent(
		spaceId: string,
		fetcher: () => Promise<SessionListFetchResult>,
	) {
		ensureBroadcastSubscription();
		const [current, result] = await Promise.all([
			readRecord(spaceId),
			fetcher(),
		]);
		const record = await writeRecord(
			spaceId,
			result.sessions,
			result.pageInfo ?? DEFAULT_SESSION_LIST_PAGE_INFO,
			result.forks !== undefined ? result.forks : current?.record.forks,
			{ completeness: "partial" },
		);
		return { ...toSnapshot(record, "network"), stale: false };
	},

	async setRecent(
		spaceId: string,
		sessions: SessionRecord[],
		pageInfo?: SessionListPageInfo | null,
		forks?: SessionListForkRecord[] | null,
	) {
		const record = await writeRecord(spaceId, sessions, pageInfo, forks);
		return toSnapshot(record, "indexeddb");
	},

	async patchRecent(
		spaceId: string,
		updater: (sessions: SessionRecord[]) => SessionRecord[],
		pageInfo?: SessionListPageInfo | null,
		forks?: SessionListForkRecord[] | null,
	) {
		const current = await readRecord(spaceId);
		const record = await writeRecord(
			spaceId,
			updater(current?.record.sessions ?? []),
			pageInfo !== undefined ? pageInfo : current?.record.pageInfo,
			forks !== undefined ? forks : current?.record.forks,
		);
		return toSnapshot(record, "indexeddb");
	},

	async deleteRecent(spaceId: string) {
		const userKey = getCacheUserKey();
		const key = sessionListKey(userKey, spaceId);
		memory.delete(key);
		await idbDelete("session_lists", key);
		publishCacheMessage({
			type: "cache-deleted",
			store: "session_lists",
			key,
			userKey,
			spaceId,
			updatedAt: Date.now(),
		});
	},

	subscribe(spaceId: string, handler: (snapshot: SessionListSnapshot) => void) {
		ensureBroadcastSubscription();
		const listener = (snapshot: SessionListSnapshot & { spaceId: string }) => {
			if (snapshot.spaceId === spaceId) handler(snapshot);
		};
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export { normalizeSessions as normalizeSessionList };
