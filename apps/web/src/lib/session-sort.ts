import type { SessionRecord } from "@neta-art/cohub";

export function getSessionActivityAt(session: SessionRecord) {
	return (
		session.lastMessageAt ?? session.updatedAt ?? session.createdAt ?? null
	);
}

export function getSessionSortTime(session: SessionRecord) {
	return Date.parse(getSessionActivityAt(session) ?? "") || 0;
}

export function compareSessionsByRecentActivity(
	a: SessionRecord,
	b: SessionRecord,
) {
	const timeDelta = getSessionSortTime(b) - getSessionSortTime(a);
	if (timeDelta !== 0) return timeDelta;
	return b.id.localeCompare(a.id);
}

export function sortSessionsByRecentActivity(sessions: SessionRecord[]) {
	return [...sessions].sort(compareSessionsByRecentActivity);
}
