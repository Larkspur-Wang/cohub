import { allowsResourceType, type CommandPaletteSearchPlan } from "./scope";
import { textMatchScore } from "./score";
import type { CommandPaletteItem } from "./types";

const COMMANDS: CommandPaletteItem[] = [
	{
		type: "command",
		id: "run-command",
		spaceId: "",
		sessionId: null,
		turnId: null,
		sequence: null,
		title: "Run Command",
		excerpt: "Execute bash in the current space",
		spaceName: null,
		sessionTitle: null,
		matchedField: "command",
		href: "#",
		score: 0.96,
		textScore: 0.96,
		recencyScore: 0.62,
		typePriorityScore: 0.9,
		updatedAt: null,
		source: "default",
	},
	{
		type: "command",
		id: "new-space",
		spaceId: "",
		sessionId: null,
		turnId: null,
		sequence: null,
		title: "New Space",
		excerpt: "Create a new space",
		spaceName: null,
		sessionTitle: null,
		matchedField: "command",
		href: "/spaces/new",
		score: 0.94,
		textScore: 0.94,
		recencyScore: 0.6,
		typePriorityScore: 0.8,
		updatedAt: null,
		source: "default",
	},
];

function commandAliases(item: CommandPaletteItem) {
	if (item.id === "run-command")
		return ["run command", "run bash", "shell", "terminal", "command"];
	if (item.id === "new-space")
		return ["new space", "create space", "space new"];
	return [item.title];
}

export function getDefaultCommandItems(plan: CommandPaletteSearchPlan) {
	if (!allowsResourceType(plan, "command")) return [];
	return COMMANDS;
}

export function searchCommandItems(plan: CommandPaletteSearchPlan) {
	if (!allowsResourceType(plan, "command")) return [];
	const query = plan.query.trim();
	if (!query) return getDefaultCommandItems(plan);
	const items: CommandPaletteItem[] = [];
	for (const item of COMMANDS) {
		const textScore = Math.max(
			textMatchScore(item.title, query),
			...commandAliases(item).map((alias) => textMatchScore(alias, query)),
		);
		if (textScore <= 0) continue;
		const score = textScore * 0.86 + item.typePriorityScore * 0.14;
		items.push({ ...item, score, textScore, source: "local" });
	}
	return items;
}
