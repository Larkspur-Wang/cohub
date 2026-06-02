import {
	idbDeleteWhere,
	type LabelItemsCacheRecord,
	type LabelTreeCacheRecord,
	openCacheDb,
	type SessionListCacheRecord,
	type SessionTurnsCacheRecord,
	type SpaceFsDirCacheRecord,
} from "$lib/cache/db";
import { getCacheUserKey } from "$lib/cache/keys";

const CLEANUP_STORAGE_KEY = "cohub:cache:last-cleanup-at:v1";
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const MAX_ENTRIES = {
	sessionLists: 500,
	sessionTurns: 1000,
	spaceFsDirs: 5000,
	labelTrees: 500,
	labelItems: 5000,
};

function shouldRunCleanup() {
	if (typeof window === "undefined") return false;
	try {
		const last = Number(window.localStorage.getItem(CLEANUP_STORAGE_KEY) ?? 0);
		return !Number.isFinite(last) || Date.now() - last > CLEANUP_INTERVAL_MS;
	} catch {
		return true;
	}
}

function markCleanupDone() {
	try {
		window.localStorage.setItem(CLEANUP_STORAGE_KEY, String(Date.now()));
	} catch {
		// ignore
	}
}

async function cleanupStore<
	T extends { key: string; userKey: string; lastAccessedAt: number },
>(
	store:
		| "session_lists"
		| "session_turns"
		| "space_fs_dirs"
		| "label_trees"
		| "label_items",
	maxEntries: number,
) {
	const userKey = getCacheUserKey();
	const db = await openCacheDb();
	if (!db?.objectStoreNames.contains(store)) return;
	const records = await new Promise<T[]>((resolve, reject) => {
		const tx = db.transaction(store, "readonly");
		const getAll = tx.objectStore(store).getAll();
		getAll.onsuccess = () => resolve((getAll.result as T[]) ?? []);
		getAll.onerror = () => reject(getAll.error);
	});
	const mine = records
		.filter((record) => record.userKey === userKey)
		.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
	const deleteCount = Math.max(0, mine.length - maxEntries);
	if (deleteCount === 0) return;
	const keysToDelete = new Set(
		mine.slice(0, deleteCount).map((record) => record.key),
	);
	await idbDeleteWhere<T & { key: string }>(store, (record) =>
		keysToDelete.has(record.key),
	);
}

export function scheduleCacheCleanup() {
	if (typeof window === "undefined" || typeof indexedDB === "undefined") return;
	if (!shouldRunCleanup()) return;
	window.setTimeout(() => {
		void Promise.all([
			cleanupStore<SessionListCacheRecord>(
				"session_lists",
				MAX_ENTRIES.sessionLists,
			),
			cleanupStore<SessionTurnsCacheRecord>(
				"session_turns",
				MAX_ENTRIES.sessionTurns,
			),
			cleanupStore<SpaceFsDirCacheRecord>(
				"space_fs_dirs",
				MAX_ENTRIES.spaceFsDirs,
			),
			cleanupStore<LabelTreeCacheRecord>("label_trees", MAX_ENTRIES.labelTrees),
			cleanupStore<LabelItemsCacheRecord>(
				"label_items",
				MAX_ENTRIES.labelItems,
			),
		])
			.then(markCleanupDone)
			.catch(() => undefined);
	}, 5000);
}
