import { parseBoardManifest } from "@cohub/protocol";
import {
	applyBoardSemanticCommands,
	BOARD_DOCUMENT_KIND,
	type BoardDocument,
	BoardDocumentSchema,
	boardDocumentToSemanticCommands,
	DEFAULT_BOARD_APPEARANCE,
	isUnknownItem,
} from "@neta-art/cohub/board";

export { DEFAULT_BOARD_APPEARANCE } from "@neta-art/cohub/board";
export { parseBoardManifest };

export function createEmptyBoardDocument(): BoardDocument {
	return BoardDocumentSchema.parse({
		kind: BOARD_DOCUMENT_KIND,
		version: 1,
		appearance: DEFAULT_BOARD_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: [],
	});
}

export function parseBoardDocument(
	content: string,
): { ok: true; document: BoardDocument } | { ok: false; error: string } {
	try {
		const parsed = BoardDocumentSchema.safeParse(JSON.parse(content || "{}"));
		return parsed.success
			? { ok: true, document: parsed.data }
			: {
					ok: false,
					error: parsed.error.issues[0]?.message ?? "Invalid board document",
				};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid JSON",
		};
	}
}

export function serializeBoardDocument(document: BoardDocument) {
	const wire = {
		kind: document.kind,
		version: document.version,
		appearance: document.appearance,
		viewport: document.viewport,
		items: document.items.map((item) =>
			isUnknownItem(item)
				? {
						...item.raw,
						id: item.id,
						frame: item.frame,
						parentId: item.parentId,
					}
				: item,
		),
		connections: document.connections,
	};
	return `${JSON.stringify(wire, null, 2)}\n`;
}

/** Rebase local semantic intent on top of a newer authoritative document. */
export function rebaseOnRemote(
	baseline: BoardDocument,
	local: BoardDocument,
	remote: BoardDocument,
): { merged: BoardDocument; hadLocalChanges: boolean } {
	const commands = boardDocumentToSemanticCommands(baseline, local);
	return commands.length === 0
		? { merged: remote, hadLocalChanges: false }
		: {
				merged: applyBoardSemanticCommands(remote, commands),
				hadLocalChanges: true,
			};
}

export function reconcileExternal(
	baseline: BoardDocument,
	local: BoardDocument,
	remote: BoardDocument,
	sameDocument: boolean,
): { merged: BoardDocument; hadLocalChanges: boolean } {
	return sameDocument
		? rebaseOnRemote(baseline, local, remote)
		: { merged: remote, hadLocalChanges: false };
}
