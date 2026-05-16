import type {
	SessionForkRecord,
	SessionTurnRecord,
} from "@cohub/protocol/model";
import type { SessionRecord, SpaceFsEntry, SpaceRecord } from "@neta-art/cohub";
import type { SessionListPageInfo } from "$lib/cache/types";

export const DB_NAME = "cohub-web-cache";
export const DB_VERSION = 2;

export type SessionListForkRecord = Partial<SessionForkRecord> & {
	childSessionId: string;
	parentSessionId?: string | null;
	depth: number;
	anchorSequence?: number | null;
	createdAt?: string;
	firstUserTextAfterFork?: string | null;
	parentTitle?: string | null;
};

export type SessionListCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	kind: "recent";
	sessions: SessionRecord[];
	forks?: SessionListForkRecord[];
	pageInfo: SessionListPageInfo;
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
	completeness: "partial" | "complete";
};

export type SessionTurnsCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	sessionId: string;
	session: SessionRecord | null;
	turns: SessionTurnRecord[];
	newestSequence: number | null;
	oldestSequence: number | null;
	hasMoreOlder: boolean;
	hasMoreNewer?: boolean;
	reconciledAt: number;
	updatedAt: number;
	lastAccessedAt: number;
	tailWatermark: string | null;
};

export type SpaceFsDirCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	dirPath: string;
	entries: SpaceFsEntry[];
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
};

export type SpaceRecordCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	space: SpaceRecord;
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
};

type StoreName =
	| "session_lists"
	| "session_turns"
	| "space_fs_dirs"
	| "space_records";

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser() {
	return typeof indexedDB !== "undefined";
}

function createStore(
	db: IDBDatabase,
	name: StoreName,
	indexes: Array<{ name: string; keyPath: string | string[] }>,
) {
	if (db.objectStoreNames.contains(name)) return;
	const store = db.createObjectStore(name, { keyPath: "key" });
	for (const index of indexes) store.createIndex(index.name, index.keyPath);
}

export async function openCacheDb(): Promise<IDBDatabase | null> {
	if (!isBrowser()) return null;
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onblocked = () => {
			dbPromise = null;
			reject(new Error("IndexedDB open blocked"));
		};
		request.onupgradeneeded = () => {
			const db = request.result;
			createStore(db, "space_records", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
			createStore(db, "session_lists", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
			createStore(db, "session_turns", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_session",
					keyPath: ["userKey", "spaceId", "sessionId"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
			]);
			createStore(db, "space_fs_dirs", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_dir",
					keyPath: ["userKey", "spaceId", "dirPath"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
			]);
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});
	return dbPromise;
}

export async function deleteCacheDatabase() {
	if (!isBrowser()) return;
	const db = await dbPromise?.catch(() => null);
	db?.close();
	dbPromise = null;
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}

export async function idbGet<T>(storeName: StoreName, key: string) {
	const db = await openCacheDb();
	if (!db) return null;
	return new Promise<T | null>((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
		const request = tx.objectStore(storeName).get(key);
		request.onsuccess = () =>
			resolve((request.result as T | undefined) ?? null);
		request.onerror = () => reject(request.error);
	});
}

function sanitizeForIndexedDb<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export async function idbPut<T>(storeName: StoreName, value: T) {
	const db = await openCacheDb();
	if (!db) return;
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		tx.objectStore(storeName).put(sanitizeForIndexedDb(value));
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function idbDelete(storeName: StoreName, key: string) {
	const db = await openCacheDb();
	if (!db) return;
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		tx.objectStore(storeName).delete(key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function idbGetAllByIndex<T>(
	storeName: StoreName,
	indexName: string,
	query: IDBValidKey | IDBKeyRange,
) {
	const db = await openCacheDb();
	if (!db) return [];
	return new Promise<T[]>((resolve, reject) => {
		const tx = db.transaction(storeName, "readonly");
		const request = tx.objectStore(storeName).index(indexName).getAll(query);
		request.onsuccess = () => resolve((request.result as T[]) ?? []);
		request.onerror = () => reject(request.error);
	});
}

export async function idbDeleteWhere<T extends { key: string }>(
	storeName: StoreName,
	predicate: (record: T) => boolean,
) {
	const db = await openCacheDb();
	if (!db) return;
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(storeName, "readwrite");
		const store = tx.objectStore(storeName);
		const request = store.openCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) return;
			if (predicate(cursor.value as T)) cursor.delete();
			cursor.continue();
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}
