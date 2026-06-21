import { untrack } from "svelte";

const LOCAL_BOOTSTRAP_CACHE_TIMEOUT_MS = 180;

export function withBootstrapCacheTimeout<T>(
	promise: Promise<T>,
): Promise<T | null> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return Promise.race([
		promise.catch(() => null),
		new Promise<null>((resolve) => {
			timer = setTimeout(resolve, LOCAL_BOOTSTRAP_CACHE_TIMEOUT_MS, null);
		}),
	]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

export function createSpaceBootstrapController(options: {
	getSpaceId: () => string;
	getPageMounted: () => boolean;
	onEnterSpace: (spaceId: string) => void;
	onBootstrap: (spaceId: string) => Promise<void>;
}) {
	let loadedSpaceId = $state<string | null>(null);
	let bootstrapping = $state(true);

	function resetLoaded() {
		loadedSpaceId = null;
	}

	function runForCurrentSpace() {
		const currentSpaceId = options.getSpaceId();
		if (
			!options.getPageMounted() ||
			!currentSpaceId ||
			loadedSpaceId === currentSpaceId
		)
			return;
		loadedSpaceId = currentSpaceId;
		options.onEnterSpace(currentSpaceId);
		bootstrapping = true;
		untrack(() => {
			void options.onBootstrap(currentSpaceId).finally(() => {
				if (options.getSpaceId() === currentSpaceId) bootstrapping = false;
			});
		});
	}

	return {
		get bootstrapping() {
			return bootstrapping;
		},
		resetLoaded,
		runForCurrentSpace,
	};
}
