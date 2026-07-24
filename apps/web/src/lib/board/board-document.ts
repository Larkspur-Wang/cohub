import { BOARD_MANIFEST_KIND } from "@cohub/protocol";
import type {
	BoardDocumentRecord,
	BoardNodeInput,
	BoardNodeRecord,
	BoardSemanticOp,
} from "@neta-art/cohub";
import {
	BOARD_DOCUMENT_KIND,
	type BoardAppearance,
	BoardAppearanceSchema,
	type BoardArrowItem,
	type BoardDocument,
	BoardDocumentSchema,
	type BoardDrawItem,
	type BoardItem,
	type BoardMediaSnapshot,
	isUnknownItem,
	UNKNOWN_BOARD_ITEM_TYPE,
	unknownRealType,
} from "$lib/board/board-schema";

export const DEFAULT_BOARD_APPEARANCE: BoardAppearance =
	BoardAppearanceSchema.parse({
		theme: "clean",
		background: { kind: "solid" },
		grid: { visible: false, size: 24, opacity: 0.12 },
		mood: "clean",
	});

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
		const raw = JSON.parse(content || "{}");
		const parsed = BoardDocumentSchema.safeParse(raw);
		if (!parsed.success) {
			return {
				ok: false,
				error: parsed.error.issues[0]?.message ?? "Invalid board document",
			};
		}
		return { ok: true, document: parsed.data };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Invalid JSON",
		};
	}
}

export function serializeBoardDocument(document: BoardDocument) {
	// Unknown items are emitted from their preserved `raw` record so a shape
	// authored by a newer client round-trips unchanged — but the *current* id and
	// frame are merged over `raw`, so a move/resize/duplicate performed in this
	// client is not lost (raw alone would revert to the stale position/id).
	const wire = {
		kind: document.kind,
		version: document.version,
		appearance: document.appearance,
		viewport: document.viewport,
		items: document.items.map((item) =>
			isUnknownItem(item)
				? { ...item.raw, id: item.id, frame: item.frame }
				: item,
		),
	};
	return `${JSON.stringify(wire, null, 2)}\n`;
}

export type BoardManifest = {
	kind: typeof BOARD_MANIFEST_KIND;
	version: 1;
	documentId: string;
	title: string;
};

export function parseBoardManifest(content: string): BoardManifest | null {
	try {
		const raw = JSON.parse(content || "{}");
		if (
			raw?.kind === BOARD_MANIFEST_KIND &&
			raw.version === 1 &&
			typeof raw.documentId === "string" &&
			typeof raw.title === "string"
		)
			return raw as BoardManifest;
		return null;
	} catch {
		return null;
	}
}

/**
 * Fields of an item record that are stored in dedicated node columns rather
 * than in the opaque `data` blob. When preserving an unknown item we keep
 * everything *except* these in `data`, and reconstruct them from the columns on
 * the way back — so an unrecognised shape round-trips through the server without
 * losing its custom fields.
 */
const ITEM_BASE_KEYS = [
	"id",
	"type",
	"frame",
	"locked",
	"style",
	"metadata",
] as const;

/**
 * Original wire data follows an item through immutable object spreads while
 * remaining invisible to JSON serialization. Codecs can then patch only the
 * fields this client understands instead of rebuilding and truncating a node.
 */
const BOARD_NODE_SOURCE = Symbol("board-node-source");
type WireBackedBoardItem = BoardItem & {
	[BOARD_NODE_SOURCE]?: BoardNodeInput;
};

function nodeInputFromRecord(node: BoardNodeRecord): BoardNodeInput {
	return {
		nodeId: node.nodeId,
		type: node.type,
		parentId: node.parentId ?? null,
		orderKey: node.orderKey ?? null,
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
		refKind: node.refKind ?? null,
		refPath: node.refPath ?? null,
		refUrl: node.refUrl ?? null,
		view: node.view ?? {},
		style: node.style ?? {},
		animation: node.animation ?? {},
		data: node.data ?? {},
	};
}

function sourceForItem(item: BoardItem): BoardNodeInput | undefined {
	return (item as WireBackedBoardItem)[BOARD_NODE_SOURCE];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function frameFromNode(node: BoardNodeRecord): BoardItem["frame"] {
	return {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
	};
}

function lockedFromData(data: Record<string, unknown>): boolean | undefined {
	return data.locked === true ? true : undefined;
}

function styleFromNode(node: BoardNodeRecord): BoardItem["style"] {
	return Object.keys(node.style ?? {}).length
		? (node.style as BoardItem["style"])
		: undefined;
}

function spaceFilePathFromNode(node: BoardNodeRecord): string | null {
	if (node.refKind === "space_file" && node.refPath) return node.refPath;
	if (typeof node.refPath === "string" && node.refPath) return node.refPath;
	return null;
}

function boardNodeToItemValue(node: BoardNodeRecord): BoardItem {
	const frame = frameFromNode(node);
	const style = styleFromNode(node);
	const data = (node.data ?? {}) as Record<string, unknown>;
	const locked = lockedFromData(data);
	switch (node.type) {
		case "text":
			return {
				id: node.nodeId,
				type: "text",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "neutral",
				autoSize: data.autoSize !== false,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "note":
			return {
				id: node.nodeId,
				type: "note",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "amber",
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "geo":
			return {
				id: node.nodeId,
				type: "geo",
				geo: typeof data.geo === "string" ? data.geo : "rectangle",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "brand",
				fillOpacity:
					typeof data.fillOpacity === "number" ? data.fillOpacity : 0,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "draw":
			return {
				id: node.nodeId,
				type: "draw",
				points: Array.isArray(data.points)
					? (data.points as BoardDrawItem["points"])
					: [],
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 4,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "arrow":
			return {
				id: node.nodeId,
				type: "arrow",
				start: (data.start ?? {
					kind: "point",
					x: 0,
					y: 0,
				}) as BoardArrowItem["start"],
				end: (data.end ?? {
					kind: "point",
					x: 0,
					y: 0,
				}) as BoardArrowItem["end"],
				bend: typeof data.bend === "number" ? data.bend : 0,
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 2.5,
				arrowStart: Boolean(data.arrowStart),
				arrowEnd: data.arrowEnd === undefined ? true : Boolean(data.arrowEnd),
				label: typeof data.label === "string" ? data.label : "",
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "frame":
			return {
				id: node.nodeId,
				type: "frame",
				label: typeof data.label === "string" ? data.label : "Frame",
				color: typeof data.color === "string" ? data.color : "neutral",
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		case "image": {
			const path = spaceFilePathFromNode(node) ?? "missing";
			return {
				id: node.nodeId,
				type: "image",
				ref: { kind: "space-file", path },
				snapshot: node.view as BoardMediaSnapshot,
				...(data.crop && typeof data.crop === "object"
					? {
							crop: data.crop as {
								x: number;
								y: number;
								w: number;
								h: number;
							},
						}
					: {}),
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		}
		case "video": {
			const path = spaceFilePathFromNode(node) ?? "missing";
			return {
				id: node.nodeId,
				type: "video",
				ref: { kind: "space-file", path },
				snapshot: node.view as BoardMediaSnapshot,
				frame,
				...(locked ? { locked } : {}),
				style,
			};
		}
		default: {
			// Unknown shape type: preserve the node's opaque fields verbatim so a
			// newer client's shape survives a round-trip through this client. The
			// item discriminant is the reserved "unknown" literal; the real type and
			// custom fields live in `raw`.
			const raw: Record<string, unknown> = {
				...data,
				id: node.nodeId,
				type: node.type,
				frame,
			};
			if (style) raw.style = style;
			if (locked) raw.locked = true;
			return {
				id: node.nodeId,
				type: UNKNOWN_BOARD_ITEM_TYPE,
				frame,
				...(locked ? { locked } : {}),
				style,
				raw,
			};
		}
	}
}

export function boardNodeToItem(node: BoardNodeRecord): BoardItem {
	const item = boardNodeToItemValue(node);
	const metadata = isRecord(node.data?.metadata)
		? node.data.metadata
		: undefined;
	return {
		...item,
		...(metadata ? { metadata } : {}),
		[BOARD_NODE_SOURCE]: nodeInputFromRecord(node),
	} as unknown as BoardItem;
}

/**
 * Map a board item to a server node input. Known shapes patch their semantic
 * fields over the original wire record, preserving fields owned by newer
 * clients or another runtime.
 */
function boardItemToNodeWithOrder(
	item: BoardItem,
	index: number,
	rewriteOrderKey: boolean,
): BoardNodeInput {
	const source = sourceForItem(item);
	const base = {
		nodeId: item.id,
		parentId: source?.parentId ?? null,
		orderKey:
			rewriteOrderKey || !source
				? String(index).padStart(8, "0")
				: (source.orderKey ?? String(index).padStart(8, "0")),
		x: item.frame.x,
		y: item.frame.y,
		width: item.frame.width,
		height: item.frame.height,
		rotation: item.frame.rotation,
		style: item.style ?? source?.style ?? {},
		animation: source?.animation ?? {},
	};
	const preservedRef = {
		refKind: source?.refKind ?? null,
		refPath: source?.refPath ?? null,
		refUrl: source?.refUrl ?? null,
	};
	const preservedView = source?.view ?? {};
	const dataWith = (fields: Record<string, unknown>) => {
		const data = { ...(source?.data ?? {}), ...fields };
		delete data.locked;
		delete data.metadata;
		if (item.locked) data.locked = true;
		if (item.metadata) data.metadata = item.metadata;
		return data;
	};

	// Unknown items (unrecognised or malformed) are reproduced from their
	// preserved record before any type-specific handling. The node type comes from
	// the real type stored in `raw`, not the reserved "unknown" discriminant.
	if (isUnknownItem(item)) {
		const rawData: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item.raw)) {
			if (!(ITEM_BASE_KEYS as readonly string[]).includes(key))
				rawData[key] = value;
		}
		return {
			...base,
			...preservedRef,
			type: unknownRealType(item),
			view: preservedView,
			data: dataWith(rawData),
		};
	}
	switch (item.type) {
		case "text":
			return {
				...base,
				...preservedRef,
				type: "text",
				view: preservedView,
				data: dataWith({
					text: item.text,
					color: item.color,
					autoSize: item.autoSize,
				}),
			};
		case "note":
			return {
				...base,
				...preservedRef,
				type: "note",
				view: preservedView,
				data: dataWith({ text: item.text, color: item.color }),
			};
		case "geo":
			return {
				...base,
				...preservedRef,
				type: "geo",
				view: preservedView,
				data: dataWith({
					geo: item.geo,
					text: item.text,
					color: item.color,
					fillOpacity: item.fillOpacity,
				}),
			};
		case "draw":
			return {
				...base,
				...preservedRef,
				type: "draw",
				view: preservedView,
				data: dataWith({
					points: item.points,
					color: item.color,
					size: item.size,
				}),
			};
		case "arrow":
			return {
				...base,
				...preservedRef,
				type: "arrow",
				view: preservedView,
				data: dataWith({
					start: item.start,
					end: item.end,
					bend: item.bend,
					color: item.color,
					size: item.size,
					arrowStart: item.arrowStart,
					arrowEnd: item.arrowEnd,
					label: item.label,
				}),
			};
		case "frame":
			return {
				...base,
				...preservedRef,
				type: "frame",
				view: preservedView,
				data: dataWith({ label: item.label, color: item.color }),
			};
		case "image": {
			const data = dataWith({});
			delete data.crop;
			if (item.crop) data.crop = item.crop;
			return {
				...base,
				type: "image",
				refKind: "space_file",
				refPath: item.ref.path,
				refUrl: null,
				view: { ...preservedView, ...(item.snapshot ?? {}) },
				data,
			};
		}
		case "video":
			return {
				...base,
				type: "video",
				refKind: "space_file",
				refPath: item.ref.path,
				refUrl: null,
				view: { ...preservedView, ...(item.snapshot ?? {}) },
				data: dataWith({}),
			};
		default: {
			const fallback = item as { type: string; raw?: Record<string, unknown> };
			const rawData: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(fallback.raw ?? {})) {
				if (!(ITEM_BASE_KEYS as readonly string[]).includes(key))
					rawData[key] = value;
			}
			return {
				...base,
				...preservedRef,
				type: fallback.type,
				view: preservedView,
				data: dataWith(rawData),
			};
		}
	}
}

export function boardItemToNode(
	item: BoardItem,
	index: number,
): BoardNodeInput {
	return boardItemToNodeWithOrder(item, index, false);
}

export function boardBootstrapToDocument(input: {
	document: BoardDocumentRecord;
	nodes: BoardNodeRecord[];
}): BoardDocument {
	const appearance = BoardAppearanceSchema.safeParse(
		input.document.meta?.appearance,
	);
	const document = BoardDocumentSchema.parse({
		kind: BOARD_DOCUMENT_KIND,
		version: 1,
		appearance: appearance.success ? appearance.data : DEFAULT_BOARD_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: input.nodes.map(boardNodeToItem),
	});
	const sources = new Map(
		input.nodes.map((node) => [node.nodeId, nodeInputFromRecord(node)]),
	);
	return {
		...document,
		items: document.items.map((item) => ({
			...item,
			[BOARD_NODE_SOURCE]: sources.get(item.id),
		})) as BoardItem[],
	};
}

function nodeInputToItem(node: BoardNodeInput): BoardItem {
	return boardNodeToItem({
		documentId: "",
		version: 0,
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
		...node,
	});
}

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function nodePatch(before: BoardNodeInput, after: BoardNodeInput) {
	const patch: Record<string, unknown> = {};
	const inverse: Record<string, unknown> = {};
	const keys = [
		"type",
		"parentId",
		"orderKey",
		"x",
		"y",
		"width",
		"height",
		"rotation",
		"refKind",
		"refPath",
		"refUrl",
		"view",
		"style",
		"animation",
		"data",
	] as const;
	for (const key of keys) {
		if (!sameJson(before[key], after[key])) {
			patch[key] = after[key] ?? null;
			inverse[key] = before[key] ?? null;
		}
	}
	return Object.keys(patch).length ? { patch, inverse } : null;
}

export function diffBoardDocuments(
	before: BoardDocument,
	after: BoardDocument,
): BoardSemanticOp[] {
	const orderChanged =
		before.items.length !== after.items.length ||
		before.items.some((item, index) => after.items[index]?.id !== item.id);
	const beforeNodes = new Map(
		before.items.map((item, index) => [item.id, boardItemToNode(item, index)]),
	);
	const afterNodes = new Map(
		after.items.map((item, index) => [
			item.id,
			boardItemToNodeWithOrder(item, index, orderChanged),
		]),
	);
	const ops: BoardSemanticOp[] = [];
	for (const [nodeId, node] of afterNodes) {
		const previous = beforeNodes.get(nodeId);
		if (!previous) {
			ops.push({ type: "node.create", payload: { node }, inverse: { nodeId } });
			continue;
		}
		const diff = nodePatch(previous, node);
		if (diff)
			ops.push({
				type: "node.patch",
				payload: { nodeId, patch: diff.patch },
				inverse: diff.inverse,
			});
	}
	for (const [nodeId, node] of beforeNodes) {
		if (!afterNodes.has(nodeId))
			ops.push({
				type: "node.delete",
				payload: { nodeId, reason: "user-delete" },
				inverse: { node },
			});
	}
	return ops;
}

export function invertBoardOps(ops: BoardSemanticOp[]): BoardSemanticOp[] {
	const inverseOps: BoardSemanticOp[] = [];
	for (const op of [...ops].reverse()) {
		if (op.type === "document.patch") {
			const previousMeta = op.inverse?.meta;
			inverseOps.push({
				type: "document.patch",
				payload: {
					patch: {
						meta: isRecord(previousMeta) ? previousMeta : null,
					},
				},
				inverse: { meta: op.payload.patch.meta },
			});
			continue;
		}
		if (op.type === "node.create") {
			inverseOps.push({
				type: "node.delete",
				payload: { nodeId: op.payload.node.nodeId },
				inverse: op.payload,
			});
			continue;
		}
		if (op.type === "node.delete") {
			const node = op.inverse?.node;
			if (!isRecord(node)) continue;
			inverseOps.push({
				type: "node.create",
				payload: { node: node as BoardNodeInput },
				inverse: op.payload,
			});
			continue;
		}
		inverseOps.push({
			type: "node.patch",
			payload: {
				nodeId: op.payload.nodeId,
				patch: op.inverse ?? {},
			},
			inverse: op.payload.patch,
		});
	}
	return inverseOps;
}

export function applyBoardOps(
	document: BoardDocument,
	ops: BoardSemanticOp[],
): BoardDocument {
	let items = [...document.items];
	let appearance = document.appearance;
	for (const op of ops) {
		if (op.type === "document.patch") {
			const parsed = BoardAppearanceSchema.safeParse(
				op.payload.patch.meta?.appearance,
			);
			appearance = parsed.success ? parsed.data : DEFAULT_BOARD_APPEARANCE;
			continue;
		}
		if (op.type === "node.create") {
			const node = op.payload.node as BoardNodeInput | undefined;
			if (node && !items.some((item) => item.id === node.nodeId))
				items = [...items, nodeInputToItem(node)];
			continue;
		}
		if (op.type === "node.delete") {
			const nodeId = op.payload.nodeId;
			if (typeof nodeId === "string")
				items = items.filter((item) => item.id !== nodeId);
			continue;
		}
		const nodeId = op.payload.nodeId;
		const patch = op.payload.patch as Partial<BoardNodeInput> | undefined;
		if (typeof nodeId !== "string" || !patch) continue;
		items = items.map((item, index) => {
			if (item.id !== nodeId) return item;
			return nodeInputToItem({
				...boardItemToNode(item, index),
				...patch,
				nodeId,
			});
		});
	}
	return { ...document, appearance, items };
}

/**
 * Rebase local changes onto a remote document. `baseline` is the last document
 * the server is known to have; local changes are diffed against it and re-applied
 * on top of `remote`. Conflict policy follows applyBoardOps: for a given node a
 * delete beats a concurrent patch, and local changes are applied last (so local
 * wins on same-field edits).
 */
export function rebaseOnRemote(
	baseline: BoardDocument,
	local: BoardDocument,
	remote: BoardDocument,
): { merged: BoardDocument; hadLocalChanges: boolean } {
	const localOps = diffBoardDocuments(baseline, local);
	if (localOps.length === 0) return { merged: remote, hadLocalChanges: false };
	return { merged: applyBoardOps(remote, localOps), hadLocalChanges: true };
}

/**
 * Reconcile an incoming external document with local state.
 * - Same-document refresh: rebase uncommitted local changes onto the remote
 *   document (see rebaseOnRemote).
 * - Document switch: adopt the new document as-is. The previous document's
 *   local changes belong to that document and must never leak into the new one.
 */
export function reconcileExternal(
	baseline: BoardDocument,
	local: BoardDocument,
	remote: BoardDocument,
	sameDocument: boolean,
): { merged: BoardDocument; hadLocalChanges: boolean } {
	if (!sameDocument) return { merged: remote, hadLocalChanges: false };
	return rebaseOnRemote(baseline, local, remote);
}
