import { sessionGenerationStore } from "$lib/stores/session-generation.svelte";

/**
 * Process-wide lease for space-scoped generation store ownership.
 * Multiple chat hosts in the same space share generation state; only the last
 * host to leave a space may reset/clear its persisted snapshots.
 */
const leases = new Map<string, number>();

export function acquireSpaceGeneration(spaceId: string) {
	if (!spaceId) return;
	leases.set(spaceId, (leases.get(spaceId) ?? 0) + 1);
}

/**
 * Release one host's claim on a space. When the last host leaves, clear that
 * space's generation memory + persisted recovery snapshots.
 */
export function releaseSpaceGeneration(spaceId: string) {
	if (!spaceId) return;
	const next = (leases.get(spaceId) ?? 0) - 1;
	if (next > 0) {
		leases.set(spaceId, next);
		return;
	}
	leases.delete(spaceId);
	sessionGenerationStore.resetSpace(spaceId);
}

/** Test/debug helper. */
export function getSpaceGenerationLeaseCount(spaceId: string) {
	return leases.get(spaceId) ?? 0;
}
