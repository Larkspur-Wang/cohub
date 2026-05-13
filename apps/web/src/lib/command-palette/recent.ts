import { goto } from "$app/navigation";
import { getCacheUserKey } from "$lib/cache/keys";
import type { CommandPaletteItem } from "./types";

const STORAGE_PREFIX = "cohub:command-palette:recent";
const MAX_RECENT = 30;

type StoredRecent = CommandPaletteItem & { openedAt: number };

function storageKey() {
	return `${STORAGE_PREFIX}:${encodeURIComponent(getCacheUserKey())}`;
}

function safeParse(value: string | null): StoredRecent[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value) as StoredRecent[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function compactForStorage(item: CommandPaletteItem): CommandPaletteItem {
	return {
		...item,
		excerpt: item.type === "turn" ? null : item.excerpt,
		source: item.source === "recent" ? "local" : item.source,
	};
}

export function getRecentCommandItems(): CommandPaletteItem[] {
	if (typeof localStorage === "undefined") return [];
	try {
		return safeParse(localStorage.getItem(storageKey()))
			.sort((a, b) => b.openedAt - a.openedAt)
			.slice(0, MAX_RECENT)
			.map(({ openedAt: _openedAt, ...item }) => ({
				...item,
				source: "recent",
			}));
	} catch {
		return [];
	}
}

export function rememberCommandItem(item: CommandPaletteItem) {
	if (typeof localStorage === "undefined") return;
	try {
		const key = `${item.type}:${item.id || item.turnId || item.sessionId || item.spaceId}`;
		const current = safeParse(localStorage.getItem(storageKey())).filter(
			(existing) =>
				`${existing.type}:${existing.id || existing.turnId || existing.sessionId || existing.spaceId}` !==
				key,
		);
		const next: StoredRecent[] = [
			{ ...compactForStorage(item), openedAt: Date.now() },
			...current,
		].slice(0, MAX_RECENT);
		localStorage.setItem(storageKey(), JSON.stringify(next));
	} catch {
		// Recent persistence is opportunistic; never block navigation.
	}
}

export async function openCommandItem(item: CommandPaletteItem) {
	rememberCommandItem(item);
	await goto(item.href);
}
