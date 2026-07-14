import type { SpacePresenceUser } from "@neta-art/cohub";

function areJsonValuesEqual(a: unknown, b: unknown) {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== "object" || typeof b !== "object") return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

/** True when presence UI would render the same. Scalars first, then nested. */
export function arePresenceUsersEqual(
	current: SpacePresenceUser[],
	next: SpacePresenceUser[],
) {
	if (current === next) return true;
	if (current.length !== next.length) return false;
	for (let i = 0; i < current.length; i += 1) {
		const a = current[i];
		const b = next[i];
		if (!a || !b) return false;
		if (
			a.userId !== b.userId ||
			a.connectionCount !== b.connectionCount ||
			a.lastSeenAt !== b.lastSeenAt
		) {
			return false;
		}
		if (
			!areJsonValuesEqual(a.meta ?? null, b.meta ?? null) ||
			!areJsonValuesEqual(a.metas ?? [], b.metas ?? []) ||
			!areJsonValuesEqual(a.profile ?? null, b.profile ?? null)
		) {
			return false;
		}
	}
	return true;
}
