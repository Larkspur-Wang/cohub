import type { Permission } from "./types.js";

// Caches the work viewer scopes a user has already granted, so returning
// viewers can be re-authorized silently instead of seeing the consent dialog
// on every visit. The server remains the source of truth: a fresh work
// session token is always requested from the API, and a failed silent
// re-authorization clears the stale cache and falls back to the dialog.
//
// A grant expires after MAX_AGE_MS (counted from the last explicit consent);
// silent re-authorizations do not refresh it, so viewers periodically
// re-confirm. Stored in localStorage under
// "cohub:work-grants:<userUuid>:<workId>:v1".

const STORAGE_PREFIX = "cohub:work-grants";
const CACHE_VERSION = 1;
// Silent re-authorization is allowed for this long after the viewer last
// confirmed consent. Only an explicit confirmation refreshes the timestamp,
// so this acts as a periodic re-consent window rather than rolling forward
// on every silent use.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type CachedWorkGrant = {
	version: number;
	userUuid: string;
	workId: string;
	scopes: Permission[];
	updatedAt: number;
};

function isBrowser() {
	return typeof localStorage !== "undefined";
}

function storageKey(userUuid: string, workId: string) {
	return `${STORAGE_PREFIX}:${encodeURIComponent(userUuid)}:${encodeURIComponent(workId)}:v${CACHE_VERSION}`;
}

function userPrefix(userUuid: string) {
	return `${STORAGE_PREFIX}:${encodeURIComponent(userUuid)}:`;
}

function isPermissionArray(value: unknown): value is Permission[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isCachedWorkGrant(value: unknown): value is CachedWorkGrant {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<CachedWorkGrant>;
	return (
		record.version === CACHE_VERSION &&
		typeof record.userUuid === "string" &&
		typeof record.workId === "string" &&
		isPermissionArray(record.scopes) &&
		typeof record.updatedAt === "number"
	);
}

function readEntry(userUuid: string, workId: string): CachedWorkGrant | null {
	if (!isBrowser()) return null;
	const key = storageKey(userUuid, workId);
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (
			!isCachedWorkGrant(parsed) ||
			parsed.userUuid !== userUuid ||
			parsed.workId !== workId
		) {
			localStorage.removeItem(key);
			return null;
		}
		if (Date.now() - parsed.updatedAt > MAX_AGE_MS) {
			localStorage.removeItem(key);
			return null;
		}
		return parsed;
	} catch {
		try {
			localStorage.removeItem(key);
		} catch {
			// Ignore cleanup failures.
		}
		return null;
	}
}

/**
 * Returns true when the viewer has previously granted every requested scope
 * for this work, allowing a silent re-authorization.
 */
export function hasGrantedWorkScopes(
	userUuid: string | null | undefined,
	workId: string,
	scopes: readonly Permission[],
): boolean {
	if (!userUuid || !workId || scopes.length === 0) return false;
	const entry = readEntry(userUuid, workId);
	if (!entry) return false;
	const granted = new Set(entry.scopes);
	return scopes.every((scope) => granted.has(scope));
}

/**
 * Records the granted scopes for a work, merged with any previously granted
 * scopes so a growing permission set stays covered.
 */
export function setGrantedWorkScopes(
	userUuid: string | null | undefined,
	workId: string,
	scopes: readonly Permission[],
) {
	if (!userUuid || !workId || scopes.length === 0) return;
	const existing = readEntry(userUuid, workId);
	const merged = Array.from(new Set([...(existing?.scopes ?? []), ...scopes]));
	const entry: CachedWorkGrant = {
		version: CACHE_VERSION,
		userUuid,
		workId,
		scopes: merged,
		updatedAt: Date.now(),
	};
	if (!isBrowser()) return;
	try {
		localStorage.setItem(storageKey(userUuid, workId), JSON.stringify(entry));
	} catch {
		// Ignore quota and privacy-mode failures.
	}
}

/**
 * Clears cached grants. Pass a workId to clear a single work, or omit it to
 * clear every cached grant for the user (used on sign-out).
 */
export function clearGrantedWorkScopes(
	userUuid: string | null | undefined,
	workId?: string,
) {
	if (!isBrowser() || !userUuid) return;
	try {
		if (workId) {
			localStorage.removeItem(storageKey(userUuid, workId));
			return;
		}
		const prefix = userPrefix(userUuid);
		for (let i = localStorage.length - 1; i >= 0; i -= 1) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) localStorage.removeItem(key);
		}
	} catch {
		// Ignore cleanup failures.
	}
}
