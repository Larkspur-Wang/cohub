import type { SpaceFsChange, SpaceFsChangedPayload } from "@cohub/protocol/fs";
import type { SpaceFsEntry } from "@neta-art/cohub";
import {
	publishCacheMessage,
	subscribeCacheMessages,
} from "$lib/cache/broadcast";
import {
	idbDelete,
	idbDeleteWhere,
	idbGet,
	idbPut,
	type SpaceFsDirCacheRecord,
} from "$lib/cache/db";
import {
	getCacheUserKey,
	normalizeDirPath,
	spaceFsDirKey,
} from "$lib/cache/keys";
import { MemoryLru } from "$lib/cache/memory-lru";
import type { CacheSource } from "$lib/cache/types";

const SPACE_FS_TTL_MS = 60_000;
const memory = new MemoryLru<string, SpaceFsDirCacheRecord>(300);
const listeners = new Set<
	(snapshot: SpaceFsDirSnapshot & { spaceId: string; dirPath: string }) => void
>();
let subscribedToBroadcast = false;

export type SpaceFsDirSnapshot = {
	dirPath: string;
	entries: SpaceFsEntry[];
	updatedAt: number;
	stale: boolean;
	source: CacheSource;
};

function sortEntries(entries: SpaceFsEntry[]) {
	return [...entries].sort((a, b) => {
		if (a.type === "dir" && b.type !== "dir") return -1;
		if (a.type !== "dir" && b.type === "dir") return 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

function normalizeEntries(entries: SpaceFsEntry[]) {
	const byPath = new Map<string, SpaceFsEntry>();
	for (const entry of entries) byPath.set(normalizeDirPath(entry.path), entry);
	return sortEntries(Array.from(byPath.values()));
}

function basename(path: string) {
	const normalized = normalizeDirPath(path);
	return normalized.split("/").pop() ?? normalized;
}

function parentDir(path: string) {
	const normalized = normalizeDirPath(path);
	if (!normalized.includes("/")) return "";
	return normalized.slice(0, normalized.lastIndexOf("/"));
}

function buildEntry(change: SpaceFsChange): SpaceFsEntry | null {
	const path = normalizeDirPath(change.path ?? "");
	if (!path) return null;
	return {
		name: basename(path),
		path,
		type: change.nodeType === "dir" ? "dir" : "file",
		size: change.size ?? 0,
		mimeType: null,
		mtimeMs: change.mtimeMs ?? Date.now(),
	};
}

function toSnapshot(
	record: SpaceFsDirCacheRecord,
	source: CacheSource,
): SpaceFsDirSnapshot {
	return {
		dirPath: record.dirPath,
		entries: record.entries,
		updatedAt: record.updatedAt,
		stale: Date.now() - record.updatedAt >= SPACE_FS_TTL_MS,
		source,
	};
}

async function readRecord(spaceId: string, dirPath: string) {
	const userKey = getCacheUserKey();
	const normalizedDir = normalizeDirPath(dirPath);
	const key = spaceFsDirKey(userKey, spaceId, normalizedDir);
	const cached = memory.get(key);
	if (cached) return { record: cached, source: "memory" as CacheSource };
	const record = await idbGet<SpaceFsDirCacheRecord>("space_fs_dirs", key);
	if (!record) return null;
	const touched = { ...record, lastAccessedAt: Date.now() };
	memory.set(key, touched);
	void idbPut("space_fs_dirs", touched).catch(() => undefined);
	return { record: touched, source: "indexeddb" as CacheSource };
}

async function writeRecord(
	spaceId: string,
	dirPath: string,
	entries: SpaceFsEntry[],
	options?: { broadcast?: boolean; source?: CacheSource },
) {
	const userKey = getCacheUserKey();
	const normalizedDir = normalizeDirPath(dirPath);
	const key = spaceFsDirKey(userKey, spaceId, normalizedDir);
	const now = Date.now();
	const normalized = normalizeEntries(entries);
	const record: SpaceFsDirCacheRecord = {
		key,
		userKey,
		spaceId,
		dirPath: normalizedDir,
		entries: normalized,
		updatedAt: now,
		lastAccessedAt: now,
		watermark:
			normalized
				.reduce<number | null>(
					(max, entry) =>
						max == null ? entry.mtimeMs : Math.max(max, entry.mtimeMs),
					null,
				)
				?.toString() ?? null,
	};
	memory.set(key, record);
	await idbPut("space_fs_dirs", record);
	if (options?.broadcast !== false) {
		publishCacheMessage({
			type: "cache-updated",
			store: "space_fs_dirs",
			key,
			userKey,
			spaceId,
			dirPath: normalizedDir,
			updatedAt: now,
		});
	}
	emit(
		spaceId,
		normalizedDir,
		toSnapshot(record, options?.source ?? "indexeddb"),
	);
	return record;
}

function emit(spaceId: string, dirPath: string, snapshot: SpaceFsDirSnapshot) {
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("cohub:space-fs-dir-cache-updated", {
				detail: { spaceId, dirPath, entries: snapshot.entries },
			}),
		);
	}
	for (const listener of listeners) listener({ ...snapshot, spaceId, dirPath });
}

function ensureBroadcastSubscription() {
	if (subscribedToBroadcast) return;
	subscribedToBroadcast = true;
	subscribeCacheMessages((message) => {
		if (message.store !== "space_fs_dirs" || !message.spaceId) return;
		if (message.userKey !== getCacheUserKey()) return;
		if (message.key) memory.delete(message.key);
		if (message.type === "cache-scope-invalidated") {
			memory.clear();
			return;
		}
		if (!message.dirPath) return;
		if (message.type === "cache-deleted") {
			emit(message.spaceId, message.dirPath, {
				dirPath: message.dirPath,
				entries: [],
				updatedAt: message.updatedAt,
				stale: true,
				source: "indexeddb",
			});
			return;
		}
		void readRecord(message.spaceId, message.dirPath).then((result) => {
			if (result)
				emit(
					message.spaceId as string,
					message.dirPath as string,
					toSnapshot(result.record, "indexeddb"),
				);
		});
	});
}

export const spaceFsRepo = {
	async getDir(spaceId: string, dirPath: string) {
		ensureBroadcastSubscription();
		const result = await readRecord(spaceId, dirPath);
		return result ? toSnapshot(result.record, result.source) : null;
	},

	async setDir(spaceId: string, dirPath: string, entries: SpaceFsEntry[]) {
		ensureBroadcastSubscription();
		const record = await writeRecord(spaceId, dirPath, entries, {
			source: "network",
		});
		return toSnapshot(record, "network");
	},

	async patchDir(
		spaceId: string,
		dirPath: string,
		updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
	) {
		ensureBroadcastSubscription();
		const current = await readRecord(spaceId, dirPath);
		const record = await writeRecord(
			spaceId,
			dirPath,
			updater(current?.record.entries ?? []),
			{ source: "indexeddb" },
		);
		return toSnapshot(record, "indexeddb");
	},

	async clearDir(spaceId: string, dirPath: string) {
		const userKey = getCacheUserKey();
		const normalizedDir = normalizeDirPath(dirPath);
		const key = spaceFsDirKey(userKey, spaceId, normalizedDir);
		memory.delete(key);
		await idbDelete("space_fs_dirs", key);
		publishCacheMessage({
			type: "cache-deleted",
			store: "space_fs_dirs",
			key,
			userKey,
			spaceId,
			dirPath: normalizedDir,
			updatedAt: Date.now(),
		});
	},

	async clearSubtree(spaceId: string, dirPath: string) {
		const userKey = getCacheUserKey();
		const normalizedDir = normalizeDirPath(dirPath);
		await idbDeleteWhere<SpaceFsDirCacheRecord>("space_fs_dirs", (record) => {
			if (record.userKey !== userKey || record.spaceId !== spaceId)
				return false;
			if (!normalizedDir) return true;
			return (
				record.dirPath === normalizedDir ||
				record.dirPath.startsWith(`${normalizedDir}/`)
			);
		});
		memory.clear();
		publishCacheMessage({
			type: "cache-scope-invalidated",
			store: "space_fs_dirs",
			userKey,
			spaceId,
			prefix: normalizedDir,
			updatedAt: Date.now(),
		});
	},

	async applyFsChanged(spaceId: string, payload: SpaceFsChangedPayload) {
		if (payload.resync) {
			await this.clearSubtree(spaceId, "");
			return { refreshDirs: new Set<string>([""]) };
		}
		const refreshDirs = new Set<string>();
		for (const change of payload.changes) {
			const path = normalizeDirPath(change.path ?? "");
			const oldPath = normalizeDirPath(change.oldPath ?? "");
			if (path) refreshDirs.add(parentDir(path));
			if (oldPath) refreshDirs.add(parentDir(oldPath));
			if (change.nodeType === "dir" && path)
				await this.clearSubtree(spaceId, path);
			if (change.nodeType === "dir" && oldPath)
				await this.clearSubtree(spaceId, oldPath);
			if (change.kind === "delete") {
				const target = path;
				if (target)
					await this.patchDir(spaceId, parentDir(target), (entries) =>
						entries.filter((entry) => entry.path !== target),
					);
				continue;
			}
			if (change.kind === "rename" && oldPath && path) {
				await this.patchDir(spaceId, parentDir(oldPath), (entries) =>
					entries.filter((entry) => entry.path !== oldPath),
				);
				const entry = buildEntry(change);
				if (entry)
					await this.patchDir(spaceId, parentDir(path), (entries) => [
						...entries.filter((item) => item.path !== entry.path),
						entry,
					]);
				continue;
			}
			if (change.kind === "create" || change.kind === "modify") {
				const entry = buildEntry(change);
				if (entry)
					await this.patchDir(spaceId, parentDir(entry.path), (entries) => [
						...entries.filter((item) => item.path !== entry.path),
						entry,
					]);
			}
		}
		return { refreshDirs };
	},

	subscribeDir(
		spaceId: string,
		dirPath: string,
		handler: (snapshot: SpaceFsDirSnapshot) => void,
	) {
		ensureBroadcastSubscription();
		const normalizedDir = normalizeDirPath(dirPath);
		const listener = (
			snapshot: SpaceFsDirSnapshot & { spaceId: string; dirPath: string },
		) => {
			if (snapshot.spaceId === spaceId && snapshot.dirPath === normalizedDir)
				handler(snapshot);
		};
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};
