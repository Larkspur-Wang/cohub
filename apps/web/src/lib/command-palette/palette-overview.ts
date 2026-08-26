import type { PaletteOverviewResponse } from "@neta-art/cohub";
import { getCacheUserKey } from "$lib/cache/keys";
import { sdk } from "$lib/sdk";

/**
 * Client cache for /api/palette/overview — the empty-query default list data.
 *
 * Memory + localStorage snapshot with a 60s freshness window: the palette can
 * render immediately from the snapshot and refresh in the background when
 * stale. Failures degrade to `null`, which falls back to the legacy local
 * default-items path.
 */

const STORAGE_PREFIX = "cohub:palette-overview";
const CACHE_VERSION = 1;
const FRESH_MS = 60_000;
const HARD_EXPIRY_MS = 10 * 60_000;

type StoredOverview = PaletteOverviewResponse & { cachedAt: number };

let memoryCache: StoredOverview | null = null;

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function storageKey() {
	return `${STORAGE_PREFIX}:${encodeURIComponent(getCacheUserKey())}:v${CACHE_VERSION}`;
}

function safeParse(value: string | null): StoredOverview | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as StoredOverview;
		if (
			!parsed ||
			!Array.isArray(parsed.spaces) ||
			!Array.isArray(parsed.recentSessions)
		)
			return null;
		return parsed;
	} catch {
		return null;
	}
}

function readCached(): StoredOverview | null {
	if (!isBrowser()) return null;
	const stored = safeParse(localStorage.getItem(storageKey()));
	if (!stored) return null;
	if (Date.now() - stored.cachedAt > HARD_EXPIRY_MS) return null;
	return stored;
}

export type PaletteOverviewSnapshot = {
	data: PaletteOverviewResponse | null;
	isStale: boolean;
};

export function getPaletteOverviewSnapshot(): PaletteOverviewSnapshot {
	if (!memoryCache) memoryCache = readCached();
	if (!memoryCache) return { data: null, isStale: true };
	return {
		data: memoryCache,
		isStale: Date.now() - memoryCache.cachedAt > FRESH_MS,
	};
}

export function clearCachedPaletteOverview() {
	memoryCache = null;
	if (!isBrowser()) return;
	try {
		localStorage.removeItem(storageKey());
	} catch {
		// Storage is best-effort.
	}
}

export async function refreshPaletteOverview(options?: {
	signal?: AbortSignal;
}): Promise<PaletteOverviewResponse | null> {
	try {
		const fetcher: typeof fetch = (input, init) =>
			fetch(input, { ...init, signal: options?.signal });
		const data = await sdk.search.overview(undefined, fetcher);
		if (!data || !Array.isArray(data.spaces)) return null;
		const stored: StoredOverview = { ...data, cachedAt: Date.now() };
		memoryCache = stored;
		if (isBrowser()) {
			try {
				localStorage.setItem(storageKey(), JSON.stringify(stored));
			} catch {
				// Quota failures are non-fatal; memory cache still applies.
			}
		}
		return data;
	} catch (error) {
		if ((error as { name?: string })?.name !== "AbortError")
			console.warn("[palette-overview] refresh failed", error);
		return null;
	}
}
