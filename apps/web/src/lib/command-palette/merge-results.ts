import type { GlobalSearchResult } from "@neta-art/cohub";
import { sortCommandItems } from "./score";
import type { CommandPaletteItem } from "./types";

function keyFor(
	item: Pick<
		CommandPaletteItem,
		"type" | "spaceId" | "sessionId" | "turnId" | "id"
	>,
) {
	if (item.type === "turn") return `turn:${item.turnId ?? item.id}`;
	if (item.type === "session") return `session:${item.sessionId ?? item.id}`;
	if (item.type === "command") return `command:${item.id}`;
	return `space:${item.spaceId}`;
}

export function commandItemKey(
	item: Pick<
		CommandPaletteItem,
		"type" | "spaceId" | "sessionId" | "turnId" | "id"
	>,
) {
	return keyFor(item);
}

function remoteToItem(item: GlobalSearchResult): CommandPaletteItem {
	return {
		...item,
		source: "remote",
		remoteScore: item.score,
	};
}

export function mergeCommandResults(input: {
	local: CommandPaletteItem[];
	remote: GlobalSearchResult[];
	limit?: number;
}) {
	const byKey = new Map<string, CommandPaletteItem>();
	for (const item of input.local) byKey.set(keyFor(item), item);
	for (const remoteResult of input.remote) {
		const item = remoteToItem(remoteResult);
		const key = keyFor(item);
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, item);
			continue;
		}
		byKey.set(key, {
			...existing,
			...item,
			source: "local+remote",
			localScore: existing.localScore ?? existing.score,
			remoteScore: item.score,
			score: Math.max(existing.score, item.score),
			textScore: Math.max(existing.textScore, item.textScore),
			recencyScore: Math.max(existing.recencyScore, item.recencyScore),
			typePriorityScore: Math.max(
				existing.typePriorityScore,
				item.typePriorityScore,
			),
		});
	}
	return sortCommandItems([...byKey.values()]).slice(0, input.limit ?? 30);
}
