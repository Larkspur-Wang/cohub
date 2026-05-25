import type { MeResponse } from "@neta-art/cohub";

const STORAGE_PREFIX = "cohub:me-profile";
const CACHE_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CachedMeProfile = {
	version: number;
	subject: string;
	updatedAt: number;
	me: MeResponse;
};

function isBrowser() {
	return typeof localStorage !== "undefined";
}

function storageKey(subject: string) {
	return `${STORAGE_PREFIX}:${encodeURIComponent(subject)}:v${CACHE_VERSION}`;
}

function isCachedMeProfile(value: unknown): value is CachedMeProfile {
	const record = value as CachedMeProfile;
	return (
		Boolean(record) &&
		record.version === CACHE_VERSION &&
		typeof record.subject === "string" &&
		typeof record.updatedAt === "number" &&
		Boolean(record.me?.uuid) &&
		Boolean(record.me?.profile)
	);
}

export function getCachedMeProfile(subject: string | null | undefined) {
	if (!subject || !isBrowser()) return null;
	try {
		const raw = localStorage.getItem(storageKey(subject));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!isCachedMeProfile(parsed) || parsed.subject !== subject) {
			localStorage.removeItem(storageKey(subject));
			return null;
		}
		if (Date.now() - parsed.updatedAt > MAX_AGE_MS) {
			localStorage.removeItem(storageKey(subject));
			return null;
		}
		return parsed.me;
	} catch {
		try {
			localStorage.removeItem(storageKey(subject));
		} catch {
			// Ignore cleanup failures.
		}
		return null;
	}
}

export function setCachedMeProfile(
	subject: string | null | undefined,
	me: MeResponse,
) {
	if (!subject || !isBrowser()) return;
	const entry: CachedMeProfile = {
		version: CACHE_VERSION,
		subject,
		updatedAt: Date.now(),
		me,
	};
	try {
		localStorage.setItem(storageKey(subject), JSON.stringify(entry));
	} catch {
		// Ignore quota and privacy-mode failures.
	}
}

export function clearCachedMeProfile(subject?: string | null) {
	if (!isBrowser()) return;
	try {
		if (subject) {
			localStorage.removeItem(storageKey(subject));
			return;
		}
		const prefix = `${STORAGE_PREFIX}:`;
		for (let i = localStorage.length - 1; i >= 0; i -= 1) {
			const key = localStorage.key(i);
			if (key?.startsWith(prefix)) localStorage.removeItem(key);
		}
	} catch {
		// Ignore cleanup failures.
	}
}
