export function createKeyedSerialQueue() {
	const tails = new Map<string, Promise<void>>();

	return async function run<T>(
		key: string,
		task: () => T | Promise<T>,
	): Promise<T> {
		const previous = tails.get(key) ?? Promise.resolve();
		const result = previous.catch(() => undefined).then(task);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		tails.set(key, tail);

		try {
			return await result;
		} finally {
			if (tails.get(key) === tail) tails.delete(key);
		}
	};
}
