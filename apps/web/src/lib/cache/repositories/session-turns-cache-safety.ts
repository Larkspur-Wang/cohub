export async function readSessionTurnsCacheSafely<T>(input: {
	read: () => Promise<T | null>;
	onError?: (error: unknown) => void;
}) {
	try {
		return await input.read();
	} catch (error) {
		input.onError?.(error);
		return null;
	}
}

export async function persistSessionTurnsCacheSafely(input: {
	write: () => Promise<void>;
	onError?: (error: unknown) => void;
}) {
	try {
		await input.write();
		return true;
	} catch (error) {
		input.onError?.(error);
		return false;
	}
}
