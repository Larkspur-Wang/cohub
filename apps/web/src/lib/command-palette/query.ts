import type { CommandPaletteResourceType } from "./types";

const TYPE_ALIASES = new Map<string, CommandPaletteResourceType>([
	["turn", "turn"],
	["turns", "turn"],
	["session", "session"],
	["sessions", "session"],
	["space", "space"],
	["spaces", "space"],
	["command", "command"],
	["commands", "command"],
]);

const SHORT_PREFIX_TYPES = new Map<string, CommandPaletteResourceType>([
	["t", "turn"],
	["s", "session"],
	["a", "space"],
	["c", "command"],
]);

export type ParsedCommandPaletteQuery = {
	raw: string;
	query: string;
	resourceTypes?: CommandPaletteResourceType[];
	pinnedOnly: boolean;
	explicitTypeFilter: boolean;
};

function uniqueTypes(values: CommandPaletteResourceType[]) {
	return [...new Set(values)];
}

function parseTypeList(value: string) {
	const rawTypes = value
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	if (rawTypes.length === 0) return null;
	const types: CommandPaletteResourceType[] = [];
	for (const rawType of rawTypes) {
		const type = TYPE_ALIASES.get(rawType);
		if (!type) return null;
		types.push(type);
	}
	return uniqueTypes(types);
}

export function parseCommandPaletteQuery(
	input: string,
): ParsedCommandPaletteQuery {
	const raw = input;
	const trimmedStart = input.trimStart();

	const pinnedMatch = /^(p|pin|pinned):(?:\s+)?(.*)$/i.exec(trimmedStart);
	if (pinnedMatch) {
		return {
			raw,
			query: (pinnedMatch[2] ?? "").trim(),
			pinnedOnly: true,
			explicitTypeFilter: false,
		};
	}

	const longMatch = /^type:([^\s]+)(?:\s+)?(.*)$/i.exec(trimmedStart);
	if (longMatch) {
		const resourceTypes = parseTypeList(longMatch[1] ?? "");
		if (resourceTypes) {
			return {
				raw,
				query: (longMatch[2] ?? "").trim(),
				resourceTypes,
				pinnedOnly: false,
				explicitTypeFilter: true,
			};
		}
	}

	const shortMatch = /^([tsac]):(?:\s+)?(.*)$/i.exec(trimmedStart);
	if (shortMatch) {
		const type = SHORT_PREFIX_TYPES.get((shortMatch[1] ?? "").toLowerCase());
		if (type) {
			return {
				raw,
				query: (shortMatch[2] ?? "").trim(),
				resourceTypes: [type],
				pinnedOnly: false,
				explicitTypeFilter: true,
			};
		}
	}

	return {
		raw,
		query: input.trim(),
		pinnedOnly: false,
		explicitTypeFilter: false,
	};
}
