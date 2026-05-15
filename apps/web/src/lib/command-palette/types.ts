import type { GlobalSearchType, UserProfile } from "@neta-art/cohub";

export type CommandPaletteItemType = GlobalSearchType | "command";
export type CommandPaletteResourceType = CommandPaletteItemType;
export type RemoteCommandPaletteResourceType = GlobalSearchType;
export type CommandPaletteItemSource =
	| "local"
	| "remote"
	| "local+remote"
	| "recent"
	| "default";

export type CommandPaletteItem = {
	type: CommandPaletteItemType;
	id: string;
	spaceId: string;
	sessionId: string | null;
	turnId: string | null;
	sequence: number | null;
	title: string;
	excerpt: string | null;
	spaceName: string | null;
	ownerProfile?: Pick<
		UserProfile,
		"userUuid" | "displayName" | "avatarUrl"
	> | null;
	sessionTitle: string | null;
	matchedField: "userText" | "title" | "name" | "description" | "command";
	href: string;
	score: number;
	textScore: number;
	recencyScore: number;
	typePriorityScore: number;
	membershipPriorityScore?: number;
	updatedAt: string | null;
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
