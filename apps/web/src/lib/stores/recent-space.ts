// Tracks the most recently visited space so the app can resume there on next load.
// Stored in localStorage under "cohub:recent-space:<userUuid>".

const STORAGE_PREFIX = "cohub:recent-space:";

type RecentSpaceEntry = {
	spaceId: string;
	sessionId: string | null;
	timestamp: number;
};

function storageKey(userUuid: string): string {
	return `${STORAGE_PREFIX}${userUuid}`;
}

function readEntry(userUuid: string): RecentSpaceEntry | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = localStorage.getItem(storageKey(userUuid));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as RecentSpaceEntry;
		if (typeof parsed.spaceId !== "string" || !parsed.spaceId) return null;
		if (typeof parsed.timestamp !== "number") return null;
		// Expire after 90 days
		if (Date.now() - parsed.timestamp > 90 * 86_400_000) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeEntry(userUuid: string, entry: RecentSpaceEntry) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(storageKey(userUuid), JSON.stringify(entry));
	} catch {
		// Storage full or disabled — ignore gracefully.
	}
}

export function setRecentSpace(
	userUuid: string,
	spaceId: string,
	sessionId: string | null = null,
) {
	writeEntry(userUuid, { spaceId, sessionId, timestamp: Date.now() });
}

export function getRecentSpace(
	userUuid: string,
): { spaceId: string; sessionId: string | null } | null {
	const entry = readEntry(userUuid);
	if (!entry) return null;
	return { spaceId: entry.spaceId, sessionId: entry.sessionId };
}

export function clearRecentSpace(userUuid: string) {
	if (typeof window === "undefined") return;
	try {
		localStorage.removeItem(storageKey(userUuid));
	} catch {
		// ignore
	}
}
