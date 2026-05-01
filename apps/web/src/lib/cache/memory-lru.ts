export class MemoryLru<K, V> {
	readonly #maxEntries: number;
	readonly #items = new Map<K, V>();

	constructor(maxEntries: number) {
		this.#maxEntries = Math.max(1, maxEntries);
	}

	get(key: K): V | undefined {
		const value = this.#items.get(key);
		if (value === undefined) return undefined;
		this.#items.delete(key);
		this.#items.set(key, value);
		return value;
	}

	set(key: K, value: V) {
		this.#items.delete(key);
		this.#items.set(key, value);
		while (this.#items.size > this.#maxEntries) {
			const oldest = this.#items.keys().next().value as K | undefined;
			if (oldest === undefined) break;
			this.#items.delete(oldest);
		}
	}

	delete(key: K) {
		this.#items.delete(key);
	}

	clear() {
		this.#items.clear();
	}
}
