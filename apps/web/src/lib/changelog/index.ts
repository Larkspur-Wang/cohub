import rawEntries from "./entries.json";

export interface ChangelogEntry {
	version: string;
	date: string;
	tags: string[];
	highlights: string[];
	fixes?: string[];
}

export const entries: ChangelogEntry[] = rawEntries;

/** Newest entry first; null when the feed is empty. */
export const latestEntry: ChangelogEntry | null = entries[0] ?? null;
