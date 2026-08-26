import type { PaletteOverviewResponse } from "@neta-art/cohub";
import { getCacheUserKey } from "$lib/cache/keys";
import {
	isOverviewSnapshotExpired,
	isOverviewSnapshotStale,
} from "$lib/command-palette/palette-overview-staleness";
import { sdk } from "$lib/sdk";

/**
 * Client cache for /api/palette/overview — the empty-query default list data.
 *
 * Memory + localStorage snapshot with a 60s freshness window: the palette can
 * render immediately from the snapshot and refresh in the background when
 * stale. Failures degrade to `null`, which falls back to the legacy local
 * default-items path.
 *
 * Freshness is not purely time-based: sending a message (or otherwise touching
 * viewer activity) marks the cache invalidated so the very next palette open
 * refetches instead of serving pre-send data.
 */

const STORAGE_PREFIX = "cohub:palette-overview";
const CACHE_VERSION = 1;
/** Cooldown for invalidate-on-send refetches; avoids hammering on bursts. */
const INVALIDATE_COOLDOWN_MS = 5_000;

type StoredOverview = PaletteOverviewResponse & { cachedAt: number };

let memoryCache: StoredOverview | null = null;
let invalidatedAt = 0;
let lastAutoRefreshAt = 0;

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Treat an all-empty payload as "no overview": the server degrades to empty
 * structures on failure, and caching/using that would blank the default list
 * instead of falling back to the local derivation path. Genuinely empty
 * accounts are equally empty locally, so this is always safe.
 */
function isEmptyOverview(data: PaletteOverviewResponse | null): boolean {
	if (!data) return true;
	const spaces = Array.isArray(data.spaces) ? data.spaces : [];
	const sessions = Array.isArray(data.recentSessions)
		? data.recentSessions
		: [];
	return spaces.length === 0 && sessions.length === 0;
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
	if (isOverviewSnapshotExpired({ cachedAt: stored.cachedAt, now: Date.now() }))
		return null;
	if (isEmptyOverview(stored)) return null;
	return stored;
}

export type PaletteOverviewSnapshot = {
	data: PaletteOverviewResponse | null;
	/** True when the next palette open must refetch before/at first render. */
	isStale: boolean;
};

export function getPaletteOverviewSnapshot(): PaletteOverviewSnapshot {
	if (!memoryCache) memoryCache = readCached();
	if (!memoryCache || isEmptyOverview(memoryCache))
		return { data: null, isStale: true };
	return {
		data: memoryCache,
		isStale: isOverviewSnapshotStale({
			cachedAt: memoryCache.cachedAt,
			invalidatedAt,
			now: Date.now(),
		}),
	};
}

/**
 * Mark the overview cache as outdated after viewer activity (message sent,
 * session created, ...). Cheap and synchronous: the next palette open will
 * treat the snapshot as stale and refetch instead of serving pre-send data.
 */
export function invalidatePaletteOverview() {
	invalidatedAt = Date.now();
}

export function clearCachedPaletteOverview() {
	memoryCache = null;
	invalidatedAt = 0;
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
		if (isEmptyOverview(data)) {
			// Degraded/empty server payload: do not cache, fall back locally.
			clearCachedPaletteOverview();
			return null;
		}
		const stored: StoredOverview = { ...data, cachedAt: Date.now() };
		memoryCache = stored;
		if (invalidatedAt && stored.cachedAt >= invalidatedAt) {
			// Refetched after the invalidation point: fresh again.
			invalidatedAt = 0;
		}
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

/**
 * Invalidate + opportunistic background refresh after viewer activity.
 * Fire-and-forget with a short cooldown so message bursts do not refetch on
 * every keystroke-completed turn.
 */
export function noteViewerActivity() {
	invalidatePaletteOverview();
	const now = Date.now();
	if (now - lastAutoRefreshAt < INVALIDATE_COOLDOWN_MS) return;
	lastAutoRefreshAt = now;
	void refreshPaletteOverview().catch(() => {
		// Background refresh is best-effort; the stale marker stays.
	});
}
