import type { SpaceFsEntry } from "@neta-art/cohub";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";

const SPACE_FS_SCOPE_SEPARATOR = "::";
const SPACE_FS_ROOT = "__root__";

function sortEntries(entries: SpaceFsEntry[]) {
	return [...entries].sort((a, b) => {
		if (a.type === "dir" && b.type !== "dir") return -1;
		if (a.type !== "dir" && b.type === "dir") return 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

function dedupeEntries(entries: SpaceFsEntry[]) {
	const byPath = new Map<string, SpaceFsEntry>();
	for (const entry of entries) {
		byPath.set(entry.path, entry);
	}
	return sortEntries(Array.from(byPath.values()));
}

const cache = createLocalListCache<SpaceFsEntry>({
	storagePrefix: "cohub:space-fs-dir",
	cacheVersion: 1,
	updatedEventName: "cohub:space-fs-dir-updated",
	ttlMs: 60_000,
	normalize: dedupeEntries,
});

function normalizeDirPath(dirPath: string) {
	return dirPath.trim() === "" ? SPACE_FS_ROOT : dirPath;
}

function getScope(spaceId: string, dirPath: string) {
	return `${spaceId}${SPACE_FS_SCOPE_SEPARATOR}${normalizeDirPath(dirPath)}`;
}

function parseScope(scope: string) {
	const separatorIndex = scope.indexOf(SPACE_FS_SCOPE_SEPARATOR);
	if (separatorIndex <= 0) return null;
	const spaceId = scope.slice(0, separatorIndex);
	const rawDirPath = scope.slice(
		separatorIndex + SPACE_FS_SCOPE_SEPARATOR.length,
	);
	return {
		spaceId,
		dirPath: rawDirPath === SPACE_FS_ROOT ? "" : rawDirPath,
	};
}

export function getCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
): SpaceFsEntry[] | null {
	return cache.getCached(getScope(spaceId, dirPath));
}

export function getCachedSpaceFsDirMeta(spaceId: string, dirPath: string) {
	return cache.getCachedMeta(getScope(spaceId, dirPath));
}

export function setCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
	entries: SpaceFsEntry[],
): SpaceFsEntry[] {
	return cache.setCached(getScope(spaceId, dirPath), entries);
}

export function patchCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
	updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
): SpaceFsEntry[] {
	return cache.patchCached(getScope(spaceId, dirPath), updater);
}

export function clearCachedSpaceFsDir(spaceId: string, dirPath: string) {
	cache.clearCached(getScope(spaceId, dirPath));
}

export function clearCachedSpaceFsSubtree(spaceId: string, dirPath: string) {
	const normalizedDirPath = normalizeDirPath(dirPath);
	const scopePrefix = `${spaceId}${SPACE_FS_SCOPE_SEPARATOR}${normalizedDirPath}`;
	cache.clearMatchingScopes(
		(scope) => scope === scopePrefix || scope.startsWith(`${scopePrefix}/`),
	);
}

export function clearAllCachedSpaceFsDirs() {
	cache.clearAllForCurrentUser();
}

export function onSpaceFsDirCacheUpdated(
	handler: (event: {
		spaceId: string;
		dirPath: string;
		entries: SpaceFsEntry[];
	}) => void,
) {
	return cache.onUpdated(({ scope, data }) => {
		const parsed = parseScope(scope);
		if (!parsed) return;
		handler({
			spaceId: parsed.spaceId,
			dirPath: parsed.dirPath,
			entries: data,
		});
	});
}

export async function fetchSpaceFsDirWithCache(
	spaceId: string,
	dirPath: string,
	fetcher: () => Promise<SpaceFsEntry[]>,
	options?: { force?: boolean },
): Promise<SpaceFsEntry[]> {
	return cache.fetchWithCache(getScope(spaceId, dirPath), fetcher, options);
}
