import { deleteCacheDatabase } from "$lib/cache/db";

export async function clearAllIndexedDbCache() {
	await deleteCacheDatabase();
}
