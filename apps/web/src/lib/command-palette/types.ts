import type { GlobalSearchResult } from "@neta-art/cohub";

export type CommandPaletteItemType = "turn" | "session" | "space";
export type CommandPaletteItemSource =
	| "local"
	| "remote"
	| "local+remote"
	| "recent";

export type CommandPaletteItem = Omit<GlobalSearchResult, "source"> & {
	type: CommandPaletteItemType;
	source: CommandPaletteItemSource;
	localScore?: number;
	remoteScore?: number;
};

export type CommandPaletteSearchState = {
	items: CommandPaletteItem[];
	localDone: boolean;
	remoteDone: boolean;
	remoteError: string | null;
};
