// Remembers the last chat opened on the cross-space /sessions inbox.
// Stored in localStorage under "cohub:last-user-session:<userUuid>:v1".

const STORAGE_PREFIX = "cohub:last-user-session:";
const STORAGE_VERSION = "v1";

function storageKey(userUuid: string): string {
	return `${STORAGE_PREFIX}${userUuid}:${STORAGE_VERSION}`;
}

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function getLastUserSessionId(userUuid: string): string | null {
	if (!userUuid || !isBrowser()) return null;
	try {
		const raw = localStorage.getItem(storageKey(userUuid));
		if (!raw) return null;
		const sessionId = String(raw).trim();
		return sessionId || null;
	} catch {
		return null;
	}
}

export function setLastUserSessionId(
	userUuid: string,
	sessionId: string,
): void {
	if (!userUuid || !sessionId || !isBrowser()) return;
	try {
		localStorage.setItem(storageKey(userUuid), sessionId);
	} catch {
		// Storage full or disabled — ignore gracefully.
	}
}

export function clearLastUserSessionId(userUuid: string): void {
	if (!userUuid || !isBrowser()) return;
	try {
		localStorage.removeItem(storageKey(userUuid));
	} catch {
		// Ignore storage failures.
	}
}
