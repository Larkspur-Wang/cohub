import type {
	SessionForkRecord,
	SessionTurnRecord,
} from "@cohub/protocol/model";
import type {
	LabelAssignmentListItem,
	LabelAssignmentPageInfo,
	LabelAssignmentRecord,
	LabelListItem,
	SessionRecord,
	SpaceFsEntry,
	SpaceRecord,
	TaskRunRecord,
} from "@neta-art/cohub";
import type { SessionListPageInfo } from "$lib/cache/types";

export const DB_NAME = "cohub-web-cache";
export const DB_VERSION = 5;

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

export type LabelTreeCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	labels: LabelListItem[];
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
};

export type LabelItemsCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	labelId: string;
	items: LabelAssignmentListItem[];
	pageInfo: LabelAssignmentPageInfo;
	updatedAt: number;
	lastAccessedAt: number;
	watermark: string | null;
	completeness: "partial" | "complete";
};

export type ResourceLabelsCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	resourceType: string;
	resourceRef: string;
	labels: LabelListItem[];
	assignments: LabelAssignmentRecord[];
	updatedAt: number;
	lastAccessedAt: number;
};

export type TaskRunSummaryCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	sessionId: string | null;
	turnId: string | null;
	taskRunId: string;
	taskType: string;
	status: TaskRunRecord["status"];
	run: TaskRunRecord;
	updatedAt: number;
	lastAccessedAt: number;
};

export type TaskRunDetailCacheRecord = {
	key: string;
	userKey: string;
	spaceId: string;
	sessionId: string | null;
	turnId: string | null;
	taskRunId: string;
	taskType: string;
	run: TaskRunRecord;
	progress: unknown;
	updatedAt: number;
	lastAccessedAt: number;
};

type StoreName =
	| "session_lists"
	| "session_turns"
	| "space_fs_dirs"
	| "space_records"
	| "label_trees"
	| "label_items"
	| "resource_labels"
	| "task_run_summaries"
	| "task_run_details";

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowser() {
	return typeof indexedDB !== "undefined";
}

function isClosingConnectionError(error: unknown) {
	return error instanceof DOMException && error.name === "InvalidStateError";
}

function resetDbConnection(db?: IDBDatabase | null) {
	try {
		db?.close();
	} catch {
		// ignore
	}
	dbPromise = null;
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
			createStore(db, "label_trees", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
			createStore(db, "label_items", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_label",
					keyPath: ["userKey", "spaceId", "labelId"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
			createStore(db, "resource_labels", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_resource",
					keyPath: ["userKey", "spaceId", "resourceType", "resourceRef"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
			]);
			createStore(db, "task_run_summaries", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_session",
					keyPath: ["userKey", "spaceId", "sessionId"],
				},
				{
					name: "by_user_space_task",
					keyPath: ["userKey", "spaceId", "taskRunId"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
			createStore(db, "task_run_details", [
				{ name: "by_user_space", keyPath: ["userKey", "spaceId"] },
				{
					name: "by_user_space_session",
					keyPath: ["userKey", "spaceId", "sessionId"],
				},
				{
					name: "by_user_space_task",
					keyPath: ["userKey", "spaceId", "taskRunId"],
				},
				{ name: "by_last_accessed", keyPath: "lastAccessedAt" },
				{ name: "by_updated_at", keyPath: "updatedAt" },
			]);
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => resetDbConnection(db);
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
	resetDbConnection(db);
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}

async function withObjectStore<T>(
	storeName: StoreName,
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore, tx: IDBTransaction) => T,
	retry = true,
): Promise<T | null> {
	const db = await openCacheDb();
	if (!db) return null;
	try {
		const tx = db.transaction(storeName, mode);
		return run(tx.objectStore(storeName), tx);
	} catch (error) {
		if (retry && isClosingConnectionError(error)) {
			resetDbConnection(db);
			return withObjectStore(storeName, mode, run, false);
		}
		throw error;
	}
}

export async function idbGet<T>(storeName: StoreName, key: string) {
	return withObjectStore(storeName, "readonly", (store) => {
		return new Promise<T | null>((resolve, reject) => {
			const request = store.get(key);
			request.onsuccess = () =>
				resolve((request.result as T | undefined) ?? null);
			request.onerror = () => reject(request.error);
		});
	});
}

function sanitizeForIndexedDb<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export async function idbPut<T>(storeName: StoreName, value: T) {
	await withObjectStore(storeName, "readwrite", (store, tx) => {
		return new Promise<void>((resolve, reject) => {
			store.put(sanitizeForIndexedDb(value));
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	});
}

export async function idbDelete(storeName: StoreName, key: string) {
	await withObjectStore(storeName, "readwrite", (store, tx) => {
		return new Promise<void>((resolve, reject) => {
			store.delete(key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
	});
}

export async function idbGetAll<T>(storeName: StoreName) {
	return (
		(await withObjectStore(storeName, "readonly", (store) => {
			return new Promise<T[]>((resolve, reject) => {
				const request = store.getAll();
				request.onsuccess = () => resolve((request.result as T[]) ?? []);
				request.onerror = () => reject(request.error);
			});
		})) ?? []
	);
}

export async function idbGetAllByIndex<T>(
	storeName: StoreName,
	indexName: string,
	query: IDBValidKey | IDBKeyRange,
) {
	return (
		(await withObjectStore(storeName, "readonly", (store) => {
			return new Promise<T[]>((resolve, reject) => {
				const request = store.index(indexName).getAll(query);
				request.onsuccess = () => resolve((request.result as T[]) ?? []);
				request.onerror = () => reject(request.error);
			});
		})) ?? []
	);
}

export async function idbDeleteWhere<T extends { key: string }>(
	storeName: StoreName,
	predicate: (record: T) => boolean,
) {
	await withObjectStore(storeName, "readwrite", (store, tx) => {
		return new Promise<void>((resolve, reject) => {
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
	});
}
