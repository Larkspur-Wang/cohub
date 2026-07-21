import { Assets, type Texture } from "pixi.js";
import { resolveSpaceFileImageUrl } from "$lib/canvas/canvas-image-urls";
import { inferMediaKind } from "$lib/canvas/canvas-media";
import type { CanvasItem } from "$lib/canvas/canvas-schema";

/**
 * Stable cache key for an image resource item, or null if it is not an image.
 * Space files and remote URLs are namespaced so they can never collide.
 */
export function imageAssetKey(item: CanvasItem): string | null {
	if (item.type !== "resource") return null;
	const value = item.ref.kind === "space-file" ? item.ref.path : item.ref.url;
	const isImage =
		item.snapshot?.mimeType?.startsWith("image/") ||
		inferMediaKind(value, item.snapshot?.mimeType) === "image";
	if (!isImage) return null;
	return item.ref.kind === "space-file"
		? `file:${item.ref.path}`
		: `url:${value}`;
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
};

export type CanvasAssetManager = {
	requestItem: (item: CanvasItem) => void;
	getTexture: (key: string) => Texture | null;
	hasError: (key: string) => boolean;
	acquire: (key: string) => void;
	release: (key: string) => void;
	subscribe: (listener: () => void) => () => void;
	destroy: () => void;
};

const MAX_RETRY_DELAY = 30_000;

/**
 * Single owner of image data for the canvas: URL resolution (space file →
 * display URL), texture loading (via `Assets.load`, which actually fetches —
 * `Texture.from(url)` only reads the cache), reference counting, a bounded
 * concurrency pool, and timer-driven retries with exponential backoff.
 *
 * Lifecycle invariants:
 * - An entry is never deleted while its request is in flight; `release` only
 *   drops `refs` to zero and the settle step reclaims it. This prevents a
 *   detached-entry race where a late load writes into an orphaned entry while a
 *   fresh entry for the same key stays blank.
 * - On settle we verify the entry is still the one in the map; an orphaned
 *   result is unloaded rather than leaked.
 * - On failure with live references a timer re-enqueues the load after the
 *   backoff elapses, so a failed image recovers even on a static canvas.
 *
 * Ownership scope: textures are loaded through Pixi's global `Assets` cache but
 * reference-counted per manager, and `evict` calls the global `Assets.unload`.
 * This is safe under the app's invariant that a single canvas stage is mounted
 * at a time; if multiple consumers ever share a URL, this must move to an
 * app-level shared reference count.
 */
export function createCanvasAssetManager(options: {
	spaceId: string;
	concurrency?: number;
}): CanvasAssetManager {
	const concurrency = options.concurrency ?? 4;
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
			};
			entries.set(key, entry);
		}
		return entry;
	}

	/** Re-enqueue a failed entry once its backoff has elapsed. */
	function scheduleRetry(key: string, entry: Entry) {
		clearRetry(entry);
		const delay = Math.max(0, entry.retryAt - Date.now());
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
		if (entry.url) void Assets.unload(entry.url).catch(() => {});
		else entry.texture?.destroy(true);
		entries.delete(key);
	}

	function settle(key: string, entry: Entry, texture: Texture | null) {
		entry.loading = false;
		inflight.delete(key);
		active -= 1;
		// Orphaned: the entry was replaced while loading. Discard the result.
		if (entries.get(key) !== entry) {
			if (texture && entry.url) void Assets.unload(entry.url).catch(() => {});
			else texture?.destroy(true);
			if (!disposed) pump();
			return;
		}
		if (texture) {
			entry.error = false;
			entry.attempts = 0;
			entry.texture = texture;
			// No live reference — reclaim immediately instead of leaking GPU memory.
			if (entry.refs <= 0) evict(key, entry);
			else notify();
		} else {
			entry.error = true;
			entry.attempts += 1;
			entry.retryAt =
				Date.now() + Math.min(1000 * 2 ** entry.attempts, MAX_RETRY_DELAY);
			console.warn(`[canvas] failed to load image for ${key}`);
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
				.then((url) => {
					if (!url || disposed) return null;
					entry.url = url;
					return Assets.load<Texture>(url);
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
			if (!key || item.type !== "resource") return;
			const entry = ensureEntry(key);
			if (entry.texture || entry.loading) return;
			// Honour backoff after a failure.
			if (entry.error && Date.now() < entry.retryAt) return;
			entry.error = false;
			clearRetry(entry);
			if (queue.some((queued) => queued.key === key)) return;
			const ref = item.ref;
			const getUrl =
				ref.kind === "space-file"
					? () => resolveSpaceFileImageUrl(options.spaceId, ref.path)
					: () => Promise.resolve(ref.url);
			resolvers.set(key, getUrl);
			queue.push({ key, getUrl });
			pump();
		},
		getTexture(key) {
			return entries.get(key)?.texture ?? null;
		},
		hasError(key) {
			return entries.get(key)?.error ?? false;
		},
		acquire(key) {
			ensureEntry(key).refs += 1;
		},
		release(key) {
			const entry = entries.get(key);
			if (!entry) return;
			entry.refs -= 1;
			if (entry.refs > 0) return;
			// Nothing references this image any more: stop any pending retry.
			clearRetry(entry);
			// Keep an in-flight entry alive until it settles; the settle step
			// reclaims it. This avoids the detached-entry race.
			if (entry.loading) return;
			evict(key, entry);
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
