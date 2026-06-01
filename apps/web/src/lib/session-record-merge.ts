import type { SessionRecord } from "@neta-art/cohub";

function hasOwn<T extends object, K extends PropertyKey>(
	value: T,
	key: K,
): value is T & Record<K, unknown> {
	return Object.hasOwn(value, key);
}

/**
 * Merge a possibly partial realtime session patch into a cached full session.
 *
 * Realtime session records intentionally omit hydrated profile fields. Treat
 * missing optional fields as "unknown / unchanged" rather than clearing local
 * cache, while still allowing explicit null / array values from list responses
 * to replace stale data.
 */
export function mergeSessionRecord(
	existing: SessionRecord | undefined | null,
	incoming: SessionRecord,
): SessionRecord {
	if (!existing) return incoming;
	return {
		...existing,
		...incoming,
		meta: hasOwn(incoming, "meta") ? incoming.meta : existing.meta,
		userProfile: hasOwn(incoming, "userProfile")
			? incoming.userProfile
			: existing.userProfile,
		participantUserUuids: hasOwn(incoming, "participantUserUuids")
			? incoming.participantUserUuids
			: existing.participantUserUuids,
		participantProfiles: hasOwn(incoming, "participantProfiles")
			? incoming.participantProfiles
			: existing.participantProfiles,
	};
}

export function mergeSessionRecords(
	sessions: SessionRecord[],
): SessionRecord[] {
	const byId = new Map<string, SessionRecord>();
	for (const session of sessions) {
		byId.set(session.id, mergeSessionRecord(byId.get(session.id), session));
	}
	return Array.from(byId.values());
}
