import type { BoardNodeInput } from "@cohub/protocol";

export {
	applyBoardItemPatch,
	boardAuthoringItemToNode,
	boardNodeToAuthoringItem,
} from "@cohub/protocol/board-codec";

/** Preserve storage fields outside the semantic Item contract during a partial edit. */
export function preserveOpaqueNodeFields(
	before: BoardNodeInput,
	compiled: BoardNodeInput,
): BoardNodeInput {
	const data = { ...before.data, ...compiled.data };
	if (!("locked" in compiled.data)) delete data.locked;
	if (!("metadata" in compiled.data)) delete data.metadata;
	return {
		...compiled,
		refKind: compiled.refKind ?? before.refKind,
		refPath: compiled.refPath ?? before.refPath,
		refUrl: compiled.refUrl ?? before.refUrl,
		view: { ...before.view, ...compiled.view },
		style: { ...before.style, ...compiled.style },
		data,
	};
}

/** Return only storage fields that changed between two compiled Items. */
export function boardNodePatch(
	before: BoardNodeInput,
	after: BoardNodeInput,
): Partial<Omit<BoardNodeInput, "nodeId">> {
	const patch: Partial<Omit<BoardNodeInput, "nodeId">> = {};
	for (const key of [
		"type", "parentId", "orderKey", "x", "y", "width", "height", "rotation",
		"refKind", "refPath", "refUrl", "view", "style", "data",
	] as const) {
		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
			(patch as Record<string, unknown>)[key] = after[key];
		}
	}
	return patch;
}
