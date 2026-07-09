const DEFAULT_RETRY_DELAY_MS = 250;

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createLazyModuleLoader<T>(
	load: () => Promise<T>,
	retryDelayMs = DEFAULT_RETRY_DELAY_MS,
) {
	let modulePromise: Promise<T> | null = null;

	async function loadWithRetry() {
		try {
			return await load();
		} catch (error) {
			if (retryDelayMs <= 0) throw error;
			await wait(retryDelayMs);
			return load();
		}
	}

	return () => {
		if (!modulePromise) {
			let nextPromise: Promise<T>;
			nextPromise = loadWithRetry().catch((error) => {
				if (modulePromise === nextPromise) modulePromise = null;
				throw error;
			});
			modulePromise = nextPromise;
		}
		return modulePromise;
	};
}
