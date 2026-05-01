import type { SpaceMarkListItem } from "@neta-art/cohub";
import { createLocalListCache } from "$lib/stores/create-local-list-cache";

const SPACE_MARKS_SCOPE_SEPARATOR = "::";
const SPACE_MARKS_KIND_PIN = "pin";

function sortMarks(marks: SpaceMarkListItem[]) {
	return [...marks].sort((a, b) => {
		if (a.rank !== b.rank) return a.rank - b.rank;
		return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
	});
}

function dedupeMarks(marks: SpaceMarkListItem[]) {
	const byId = new Map<string, SpaceMarkListItem>();
	for (const mark of marks) {
		byId.set(mark.id, mark);
	}
	return sortMarks(Array.from(byId.values()));
}

const cache = createLocalListCache<SpaceMarkListItem>({
	storagePrefix: "cohub:space-marks",
	cacheVersion: 1,
	updatedEventName: "cohub:space-marks-updated",
	ttlMs: 30_000,
	normalize: dedupeMarks,
});

function getScope(spaceId: string, kind = SPACE_MARKS_KIND_PIN) {
	return `${spaceId}${SPACE_MARKS_SCOPE_SEPARATOR}${kind}`;
}

export function getCachedSpacePins(
	spaceId: string,
): SpaceMarkListItem[] | null {
	return cache.getCached(getScope(spaceId));
}

export function getCachedSpacePinsMeta(spaceId: string) {
	return cache.getCachedMeta(getScope(spaceId));
}

export function setCachedSpacePins(
	spaceId: string,
	marks: SpaceMarkListItem[],
): SpaceMarkListItem[] {
	return cache.setCached(getScope(spaceId), marks);
}

export function patchCachedSpacePins(
	spaceId: string,
	updater: (marks: SpaceMarkListItem[]) => SpaceMarkListItem[],
): SpaceMarkListItem[] {
	return cache.patchCached(getScope(spaceId), updater);
}

export function clearCachedSpacePins(spaceId: string) {
	cache.clearCached(getScope(spaceId));
}

export function clearAllCachedSpacePins() {
	cache.clearAllForCurrentUser();
}

export function onSpacePinsCacheUpdated(
	handler: (event: { spaceId: string; marks: SpaceMarkListItem[] }) => void,
) {
	return cache.onUpdated(({ scope, data }) => {
		const [spaceId, kind] = scope.split(SPACE_MARKS_SCOPE_SEPARATOR);
		if (!spaceId || kind !== SPACE_MARKS_KIND_PIN) return;
		handler({ spaceId, marks: data });
	});
}

export async function fetchSpacePinsWithCache(
	spaceId: string,
	fetcher: () => Promise<SpaceMarkListItem[]>,
	options?: { force?: boolean },
): Promise<SpaceMarkListItem[]> {
	return cache.fetchWithCache(getScope(spaceId), fetcher, options);
}
