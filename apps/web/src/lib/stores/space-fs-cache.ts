import type { SpaceFsEntry } from "@neta-art/cohub";
import { deleteCacheDatabase } from "$lib/cache/db";
import { canUseUserScopedCache, getCacheUserKeyAsync } from "$lib/cache/keys";
import { spaceFsRepo } from "$lib/cache/repositories/space-fs-repo";

async function resolveCacheUserKey() {
	const userKey = await getCacheUserKeyAsync();
	return canUseUserScopedCache(userKey) ? userKey : null;
}

async function requireCacheUserKey() {
	const userKey = await resolveCacheUserKey();
	if (!userKey) {
		throw new Error("user-scoped cache unavailable until identity is resolved");
	}
	return userKey;
}

export async function getCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
): Promise<SpaceFsEntry[] | null> {
	if (!(await resolveCacheUserKey())) return null;
	const snapshot = await spaceFsRepo.getDir(spaceId, dirPath);
	return snapshot?.entries ?? null;
}

export async function getCachedSpaceFsDirMeta(
	spaceId: string,
	dirPath: string,
) {
	if (!(await resolveCacheUserKey())) return null;
	const snapshot = await spaceFsRepo.getDir(spaceId, dirPath);
	if (!snapshot) return null;
	return { updatedAt: snapshot.updatedAt, isStale: snapshot.stale };
}

export async function setCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
	entries: SpaceFsEntry[],
): Promise<SpaceFsEntry[]> {
	await requireCacheUserKey();
	const snapshot = await spaceFsRepo.setDir(spaceId, dirPath, entries);
	return snapshot.entries;
}

export async function patchCachedSpaceFsDir(
	spaceId: string,
	dirPath: string,
	updater: (entries: SpaceFsEntry[]) => SpaceFsEntry[],
): Promise<SpaceFsEntry[]> {
	await requireCacheUserKey();
	const snapshot = await spaceFsRepo.patchDir(spaceId, dirPath, updater);
	return snapshot.entries;
}

export async function clearCachedSpaceFsDir(spaceId: string, dirPath: string) {
	await requireCacheUserKey();
	await spaceFsRepo.clearDir(spaceId, dirPath);
}

export async function clearCachedSpaceFsSubtree(
	spaceId: string,
	dirPath: string,
) {
	await requireCacheUserKey();
	await spaceFsRepo.clearSubtree(spaceId, dirPath);
}

export async function clearAllCachedSpaceFsDirs() {
	await deleteCacheDatabase();
}

export function onSpaceFsDirCacheUpdated(
	handler: (event: {
		spaceId: string;
		dirPath: string;
		entries: SpaceFsEntry[];
	}) => void,
) {
	const listener = (event: Event) => {
		const custom = event as CustomEvent<{
			spaceId: string;
			dirPath: string;
			entries: SpaceFsEntry[];
		}>;
		if (!custom.detail?.spaceId) return;
		handler(custom.detail);
	};
	if (typeof window !== "undefined")
		window.addEventListener("cohub:space-fs-dir-cache-updated", listener);
	return () => {
		if (typeof window !== "undefined")
			window.removeEventListener("cohub:space-fs-dir-cache-updated", listener);
	};
}

export async function fetchSpaceFsDirWithCache(
	spaceId: string,
	dirPath: string,
	fetcher: () => Promise<SpaceFsEntry[]>,
	options?: { force?: boolean },
): Promise<SpaceFsEntry[]> {
	await requireCacheUserKey();
	if (!options?.force) {
		const cached = await spaceFsRepo.getDir(spaceId, dirPath);
		if (cached && !cached.stale) return cached.entries;
	}
	const snapshot = await spaceFsRepo.setDir(spaceId, dirPath, await fetcher());
	return snapshot.entries;
}
