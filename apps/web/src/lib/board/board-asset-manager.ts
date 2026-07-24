import { Assets, type Texture } from "pixi.js";
import {
	DEFAULT_LRU_BUDGET,
	type LruBudget,
	type LruEntry,
	selectLruEvictions,
} from "$lib/board/board-asset-lru";
import type { BoardItem } from "$lib/board/board-schema";

/**
 * Stable cache key for an image resource item, or null if it is not an image.
 * Space files and remote URLs are namespaced so they can never collide.
 */
export function imageAssetKey(item: BoardItem): string | null {
	if (item.type === "image") return `file:${item.ref.path}`;
	return null;
}

type Entry = {
	url: string | null;
	texture: Texture | null;
	refs: number;
	loading: boolean;
	error: boolean;
	attempts: number;
	retryAt: number;
	retryTimer: ReturnType<typeof setTimeout> | null;
	/** Last time this image was wanted (acquired or requested); drives LRU. */
	lastUsedAt: number;
};

export type BoardAssetManager = {
	requestItem: (item: BoardItem) => void;
	getTexture: (key: string) => Texture | null;
	hasError: (key: string) => boolean;
	acquire: (key: string) => void;
	release: (key: string) => void;
	subscribe: (listener: () => void) => () => void;
	destroy: () => void;
};

const MAX_RETRY_DELAY = 30_000;

/** Approximate GPU footprint of a texture (RGBA8). Unknown sizes count as 0. */
function footprintOf(texture: Texture | null): number {
	if (!texture) return 0;
	const width = texture.width || 0;
	const height = texture.height || 0;
	return width * height * 4;
}

/**
 * Default space-file URL resolver. The SDK-backed resolver is imported lazily so
 * this module has no static dependency on the SDK / SvelteKit runtime — keeping
 * it importable in plain node tests (remote URLs never trigger this path).
 */
async function defaultResolveSpaceFileUrl(
	spaceId: string,
	path: string,
): Promise<string | null> {
	const { resolveSpaceFileImageUrl } = await import(
		"$lib/board/board-image-urls"
	);
	return resolveSpaceFileImageUrl(spaceId, path);
}

export type BoardAssetManagerOptions = {
	spaceId: string;
	concurrency?: number;
	/** Cooling-pool ceiling for unreferenced textures kept on the GPU. */
	lruBudget?: LruBudget;
	/** Injectable texture loaders (default: Pixi's global Assets cache). */
	loadTexture?: (url: string) => Promise<Texture | null>;
	/**
	 * Frees a texture. Must resolve once the texture is truly gone, so a pending
	 * unload of a URL can be awaited before that URL is loaded again (otherwise a
	 * quick pan-back could re-acquire a texture that is still being unloaded and
	 * is about to be destroyed). Defaults to Pixi's global Assets cache.
	 */
	unloadTexture?: (url: string, texture: Texture | null) => Promise<void>;
	/**
	 * Resolves a displayable URL for a space-file image. Injected so the manager
	 * has no static dependency on the SDK (and thus SvelteKit runtime), keeping
	 * it unit-testable. Defaults to the CDN/base64 resolver.
	 */
	resolveSpaceFileUrl?: (
		spaceId: string,
		path: string,
	) => Promise<string | null>;
	/** Injectable clock for tests. */
	now?: () => number;
};

/**
 * Single owner of image data for the board: URL resolution (space file →
 * display URL), texture loading, reference counting, a bounded concurrency
 * pool, timer-driven retries with exponential backoff, and an LRU cooling pool
 * for off-screen textures.
 *
 * Reference model: `refs` counts how many *visible* cards display an image.
 * When the last reference is released the texture is not freed immediately —
 * it stays on the GPU in a cooling pool so a quick pan back is instant. The
 * pool is bounded (count + bytes); the least recently used entries are evicted
 * first when a budget is exceeded. This balances GPU retention against the
 * churn of re-fetching textures while panning.
 *
 * Lifecycle invariants:
 * - An entry is never deleted while its request is in flight; `release` only
 *   drops `refs` to zero and the settle step cools or reclaims it. This
 *   prevents a detached-entry race where a late load writes into an orphaned
 *   entry while a fresh entry for the same key stays blank.
 * - On settle we verify the entry is still the one in the map; an orphaned
 *   result is unloaded rather than leaked.
 * - On failure with live references a timer re-enqueues the load after the
 *   backoff elapses, so a failed image recovers even on a static board.
 *
 * Ownership scope: textures load through Pixi's global `Assets` cache but are
 * reference-counted per manager, and eviction calls the global `Assets.unload`.
 * This is safe under the app's invariant that a single board stage is mounted
 * at a time; if multiple consumers ever share a URL, this must move to an
 * app-level shared reference count.
 */
export function createBoardAssetManager(
	options: BoardAssetManagerOptions,
): BoardAssetManager {
	const concurrency = options.concurrency ?? 4;
	const budget = options.lruBudget ?? DEFAULT_LRU_BUDGET;
	const now = options.now ?? (() => Date.now());
	const loadTexture =
		options.loadTexture ?? ((url) => Assets.load<Texture>(url));
	// In-flight unloads keyed by URL. A load of the same URL awaits any pending
	// unload first, closing the race where a re-requested texture is handed back
	// by the shared Assets cache while still being unloaded (then destroyed).
	const pendingUnloads = new Map<string, Promise<void>>();
	const unloadTexture =
		options.unloadTexture ??
		((url, texture) => {
			if (!url) {
				texture?.destroy(true);
				return Promise.resolve();
			}
			return Assets.unload(url).catch(() => {});
		});
	/** Unload a texture and, for URL-backed ones, track it so a reload waits. */
	function releaseTexture(url: string, texture: Texture | null) {
		const promise = unloadTexture(url, texture)
			.catch(() => {})
			.then(() => {
				if (url && pendingUnloads.get(url) === promise)
					pendingUnloads.delete(url);
			});
		if (url) pendingUnloads.set(url, promise);
	}
	const resolveSpaceFileUrl =
		options.resolveSpaceFileUrl ?? defaultResolveSpaceFileUrl;

	const entries = new Map<string, Entry>();
	const resolvers = new Map<string, () => Promise<string | null>>();
	const inflight = new Set<string>();
	const queue: Array<{ key: string; getUrl: () => Promise<string | null> }> =
		[];
	const listeners = new Set<() => void>();
	let active = 0;
	let disposed = false;

	function notify() {
		for (const listener of listeners) listener();
	}

	function clearRetry(entry: Entry) {
		if (entry.retryTimer) {
			clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
		}
	}

	function ensureEntry(key: string): Entry {
		let entry = entries.get(key);
		if (!entry) {
			entry = {
				url: null,
				texture: null,
				refs: 0,
				loading: false,
				error: false,
				attempts: 0,
				retryAt: 0,
				retryTimer: null,
				lastUsedAt: now(),
			};
			entries.set(key, entry);
		}
		return entry;
	}

	/** Re-enqueue a failed entry once its backoff has elapsed. */
	function scheduleRetry(key: string, entry: Entry) {
		clearRetry(entry);
		const delay = Math.max(0, entry.retryAt - now());
		entry.retryTimer = setTimeout(() => {
			entry.retryTimer = null;
			if (disposed || entries.get(key) !== entry) return;
			if (entry.refs <= 0 || entry.texture || entry.loading) return;
			const getUrl = resolvers.get(key);
			if (!getUrl) return;
			entry.error = false;
			if (!queue.some((task) => task.key === key)) {
				queue.push({ key, getUrl });
				pump();
			}
		}, delay);
	}

	function evict(key: string, entry: Entry) {
		clearRetry(entry);
		resolvers.delete(key);
		if (entry.url || entry.texture)
			releaseTexture(entry.url ?? "", entry.texture);
		entries.delete(key);
	}

	/**
	 * Drop unreferenced, loaded textures that exceed the cooling budget. Entries
	 * still in flight are untouched (the settle step cools them once they land).
	 */
	function trim() {
		const cooling: LruEntry[] = [];
		for (const [key, entry] of entries) {
			if (entry.refs <= 0 && entry.texture && !entry.loading)
				cooling.push({
					key,
					lastUsedAt: entry.lastUsedAt,
					bytes: footprintOf(entry.texture),
				});
		}
		const evictions = selectLruEvictions(cooling, budget);
		for (const key of evictions) {
			const entry = entries.get(key);
			if (entry) evict(key, entry);
		}
	}

	function settle(key: string, entry: Entry, texture: Texture | null) {
		entry.loading = false;
		inflight.delete(key);
		active -= 1;
		// Orphaned: the entry was replaced while loading. Discard the result.
		if (entries.get(key) !== entry) {
			if (texture) releaseTexture(entry.url ?? "", texture);
			if (!disposed) pump();
			return;
		}
		if (texture) {
			entry.error = false;
			entry.attempts = 0;
			entry.texture = texture;
			entry.lastUsedAt = now();
			// No live reference: keep it in the cooling pool (bounded by trim)
			// rather than freeing immediately, so a quick pan back is instant.
			if (entry.refs <= 0) trim();
			else notify();
		} else {
			entry.error = true;
			entry.attempts += 1;
			entry.retryAt =
				now() + Math.min(1000 * 2 ** entry.attempts, MAX_RETRY_DELAY);
			console.warn(`[board] failed to load image for ${key}`);
			if (entry.refs <= 0) evict(key, entry);
			else {
				scheduleRetry(key, entry);
				notify();
			}
		}
		if (!disposed) pump();
	}

	function pump() {
		while (!disposed && active < concurrency && queue.length > 0) {
			const task = queue.shift();
			if (!task) continue;
			const entry = entries.get(task.key);
			if (!entry || entry.texture || entry.loading) continue;
			entry.loading = true;
			inflight.add(task.key);
			active += 1;
			task
				.getUrl()
				.then(async (url) => {
					if (!url || disposed) return null;
					entry.url = url;
					// Wait for any in-flight unload of this URL so we never load a
					// texture the shared cache is about to destroy.
					const pending = pendingUnloads.get(url);
					if (pending) await pending;
					if (disposed) return null;
					return loadTexture(url);
				})
				.then(
					(texture) => settle(task.key, entry, texture ?? null),
					() => settle(task.key, entry, null),
				);
		}
	}

	return {
		requestItem(item) {
			if (disposed) return;
			const key = imageAssetKey(item);
			if (!key || item.type !== "image") return;
			const entry = ensureEntry(key);
			entry.lastUsedAt = now();
			if (entry.texture || entry.loading) return;
			// Honour backoff after a failure.
			if (entry.error && now() < entry.retryAt) return;
			entry.error = false;
			clearRetry(entry);
			if (queue.some((queued) => queued.key === key)) return;
			const path = item.ref.path;
			const getUrl = () => resolveSpaceFileUrl(options.spaceId, path);
			resolvers.set(key, getUrl);
			queue.push({ key, getUrl });
			pump();
		},
		getTexture(key) {
			const entry = entries.get(key);
			if (!entry?.texture) return null;
			entry.lastUsedAt = now();
			return entry.texture;
		},
		hasError(key) {
			return entries.get(key)?.error ?? false;
		},
		acquire(key) {
			const entry = ensureEntry(key);
			entry.refs += 1;
			entry.lastUsedAt = now();
		},
		release(key) {
			const entry = entries.get(key);
			if (!entry) return;
			entry.refs -= 1;
			if (entry.refs > 0) return;
			entry.lastUsedAt = now();
			// Nothing references this image any more: stop any pending retry.
			clearRetry(entry);
			// Keep an in-flight entry alive until it settles; the settle step
			// cools or reclaims it. This avoids the detached-entry race.
			if (entry.loading) return;
			// A failed entry with no texture and no references is reclaimed now;
			// a loaded one stays in the cooling pool until the budget says evict.
			if (!entry.texture) evict(key, entry);
			else trim();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		destroy() {
			disposed = true;
			queue.length = 0;
			listeners.clear();
			resolvers.clear();
			for (const [key, entry] of entries) evict(key, entry);
			entries.clear();
		},
	};
}
