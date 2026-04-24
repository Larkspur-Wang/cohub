import { authStore } from "$lib/stores/auth.svelte";

const DEV = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);

type CacheEntry<T> = {
	version: number;
	userKey: string;
	scope: string;
	updatedAt: number;
	data: T[];
};

type CacheUpdatedEventDetail<T> = {
	scope: string;
	data: T[];
};

type CreateLocalListCacheOptions<T> = {
	storagePrefix: string;
	cacheVersion: number;
	updatedEventName: string;
	ttlMs: number;
	normalize: (items: T[]) => T[];
};

export function createLocalListCache<T>({
	storagePrefix,
	cacheVersion,
	updatedEventName,
	ttlMs,
	normalize,
}: CreateLocalListCacheOptions<T>) {
	const memoryCache = new Map<string, CacheEntry<T>>();
	const inflightByScope = new Map<string, Promise<T[]>>();

	function isBrowser() {
		return typeof window !== "undefined" && typeof localStorage !== "undefined";
	}

	function getUserKey() {
		return authStore.userUuid ?? authStore.claims?.sub ?? "guest";
	}

	function warnDev(message: string, meta?: unknown) {
		if (!DEV) return;
		console.warn(`[local-list-cache] ${message}`, meta);
	}

	function getScopedKey(scope: string) {
		return `${getUserKey()}:${scope}`;
	}

	function getStorageKey(scope: string) {
		return `${storagePrefix}:${getUserKey()}:${scope}:v${cacheVersion}`;
	}

	function toEntry(scope: string, items: T[]): CacheEntry<T> {
		let data: T[];
		try {
			data = normalize(items);
		} catch (error) {
			warnDev("normalize failed; falling back to raw items", {
				scope,
				error,
			});
			data = [...items];
		}

		return {
			version: cacheVersion,
			userKey: getUserKey(),
			scope,
			updatedAt: Date.now(),
			data,
		};
	}

	function emitUpdated(scope: string, data: T[]) {
		if (!isBrowser()) return;
		window.dispatchEvent(
			new CustomEvent<CacheUpdatedEventDetail<T>>(updatedEventName, {
				detail: { scope, data },
			}),
		);
	}

	function readEntry(scope: string): CacheEntry<T> | null {
		const scopedKey = getScopedKey(scope);
		const memory = memoryCache.get(scopedKey);
		if (memory) return memory;
		if (!isBrowser()) return null;

		try {
			const raw = localStorage.getItem(getStorageKey(scope));
			if (!raw) return null;
			const parsed = JSON.parse(raw) as CacheEntry<T>;
			if (
				parsed.version !== cacheVersion ||
				parsed.scope !== scope ||
				!Array.isArray(parsed.data)
			) {
				localStorage.removeItem(getStorageKey(scope));
				return null;
			}
			const normalized = toEntry(scope, parsed.data);
			normalized.updatedAt =
				typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now();
			memoryCache.set(scopedKey, normalized);
			return normalized;
		} catch (error) {
			warnDev("failed to read cached entry; clearing corrupted value", {
				scope,
				error,
			});
			try {
				localStorage.removeItem(getStorageKey(scope));
			} catch {
				// ignore
			}
			return null;
		}
	}

	function getCached(scope: string): T[] | null {
		return readEntry(scope)?.data ?? null;
	}

	function getCachedMeta(scope: string) {
		const entry = readEntry(scope);
		if (!entry) return null;
		return {
			updatedAt: entry.updatedAt,
			isStale: Date.now() - entry.updatedAt >= ttlMs,
		};
	}

	function setCached(scope: string, items: T[]): T[] {
		const entry = toEntry(scope, items);
		memoryCache.set(getScopedKey(scope), entry);
		if (isBrowser()) {
			try {
				localStorage.setItem(getStorageKey(scope), JSON.stringify(entry));
			} catch {
				// ignore
			}
		}
		emitUpdated(scope, entry.data);
		return entry.data;
	}

	function patchCached(scope: string, updater: (items: T[]) => T[]): T[] {
		const current = getCached(scope) ?? [];
		return setCached(scope, updater(current));
	}

	function clearCached(scope: string) {
		memoryCache.delete(getScopedKey(scope));
		if (!isBrowser()) return;
		try {
			localStorage.removeItem(getStorageKey(scope));
		} catch {
			// ignore
		}
	}

	function clearAllForCurrentUser() {
		const prefix = `${storagePrefix}:${getUserKey()}:`;
		for (const key of memoryCache.keys()) {
			if (key.startsWith(`${getUserKey()}:`)) {
				memoryCache.delete(key);
			}
		}
		if (!isBrowser()) return;
		try {
			for (let i = localStorage.length - 1; i >= 0; i -= 1) {
				const key = localStorage.key(i);
				if (key?.startsWith(prefix)) {
					localStorage.removeItem(key);
				}
			}
		} catch {
			// ignore
		}
	}

	function onUpdated(handler: (event: CacheUpdatedEventDetail<T>) => void) {
		if (!isBrowser()) return () => {};

		const listener = (event: Event) => {
			const custom = event as CustomEvent<CacheUpdatedEventDetail<T>>;
			if (!custom.detail?.scope || !Array.isArray(custom.detail.data)) return;
			handler(custom.detail);
		};

		window.addEventListener(updatedEventName, listener as EventListener);
		return () =>
			window.removeEventListener(updatedEventName, listener as EventListener);
	}

	async function fetchWithCache(
		scope: string,
		fetcher: () => Promise<T[]>,
		options?: { force?: boolean },
	): Promise<T[]> {
		const scopedKey = getScopedKey(scope);
		const inflight = inflightByScope.get(scopedKey);
		if (inflight) return inflight;

		const request = (async () => {
			const items = await fetcher();
			return setCached(scope, items);
		})().finally(() => {
			if (inflightByScope.get(scopedKey) === request) {
				inflightByScope.delete(scopedKey);
			}
		});

		inflightByScope.set(scopedKey, request);
		return request;
	}

	return {
		getCached,
		getCachedMeta,
		setCached,
		patchCached,
		clearCached,
		clearAllForCurrentUser,
		onUpdated,
		fetchWithCache,
	};
}
