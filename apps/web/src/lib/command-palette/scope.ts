import type {
	CommandPaletteResourceType,
	RemoteCommandPaletteResourceType,
} from "./types";

export type CommandPaletteSearchPlan = {
	query: string;
	resourceTypes?: CommandPaletteResourceType[];
	labelRef?: string;
};

const REMOTE_TYPES = new Set<CommandPaletteResourceType>([
	"turn",
	"session",
	"space",
	"label",
]);

const TYPE_LABELS: Record<CommandPaletteResourceType, string> = {
	turn: "Turns",
	session: "Sessions",
	space: "Spaces",
	label: "Labels",
	command: "Commands",
};

export function allowsResourceType(
	plan: Pick<CommandPaletteSearchPlan, "resourceTypes">,
	type: CommandPaletteResourceType,
) {
	return !plan.resourceTypes || plan.resourceTypes.includes(type);
}

export function getRemoteResourceTypes(
	plan: Pick<CommandPaletteSearchPlan, "resourceTypes">,
): RemoteCommandPaletteResourceType[] | undefined {
	if (!plan.resourceTypes) return undefined;
	const types = plan.resourceTypes.filter((type) =>
		REMOTE_TYPES.has(type),
	) as RemoteCommandPaletteResourceType[];
	return types.length > 0 ? types : [];
}

export function typeLabelFor(
	resourceTypes: CommandPaletteResourceType[] | undefined,
) {
	return resourceTypes?.length
		? resourceTypes.map((type) => TYPE_LABELS[type]).join(" + ")
		: null;
}
