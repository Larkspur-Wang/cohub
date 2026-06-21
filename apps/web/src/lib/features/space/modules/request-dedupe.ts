export function createRequestDedupe() {
	const inFlight = new Map<string, Promise<unknown>>();

	function run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const existing = inFlight.get(key) as Promise<T> | undefined;
		if (existing) return existing;
		const request = task().finally(() => {
			if (inFlight.get(key) === request) inFlight.delete(key);
		});
		inFlight.set(key, request);
		return request;
	}

	function clear() {
		inFlight.clear();
	}

	return { run, clear };
}
