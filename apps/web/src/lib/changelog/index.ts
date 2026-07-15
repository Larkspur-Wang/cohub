import rawEntries from "./entries.json";

export interface ChangelogEntry {
	version: string;
	date: string;
	tags: string[];
	highlights: string[];
	fixes?: string[];
}

export const entries: ChangelogEntry[] = rawEntries;
