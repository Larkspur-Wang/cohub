import type {
	CanvasDocumentRecord,
	CanvasNodeInput,
	CanvasNodeRecord,
	CanvasSemanticOp,
} from "@neta-art/cohub";
import {
	CANVAS_DOCUMENT_KIND,
	type CanvasAppearance,
	CanvasAppearanceSchema,
	type CanvasArrowItem,
	type CanvasDrawItem,
	type CanvasItem,
	type CanvasResourceItem,
	type CanvasResourceSnapshot,
	type CovasDocument,
	CovasDocumentSchema,
	isUnknownItem,
	UNKNOWN_CANVAS_ITEM_TYPE,
	unknownRealType,
} from "$lib/canvas/canvas-schema";

export const DEFAULT_CANVAS_APPEARANCE: CanvasAppearance =
	CanvasAppearanceSchema.parse({
		theme: "clean",
		background: { kind: "grid" },
		grid: { visible: true, size: 32, opacity: 0.22 },
		mood: "clean",
	});

export function createEmptyCovasDocument(): CovasDocument {
	return CovasDocumentSchema.parse({
		kind: CANVAS_DOCUMENT_KIND,
		version: 1,
		appearance: DEFAULT_CANVAS_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: [],
	});
}

export function parseCovasDocument(
	content: string,
): { ok: true; document: CovasDocument } | { ok: false; error: string } {
	try {
		const raw = JSON.parse(content || "{}");
		const parsed = CovasDocumentSchema.safeParse(raw);
		if (!parsed.success) {
			return {
				ok: false,
				error: parsed.error.issues[0]?.message ?? "Invalid canvas document",
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

export function serializeCovasDocument(document: CovasDocument) {
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

export type CovasManifest = {
	kind: "cohub.canvas.manifest";
	version: 1;
	documentId: string;
	title: string;
};

export function parseCovasManifest(content: string): CovasManifest | null {
	try {
		const raw = JSON.parse(content || "{}");
		if (
			raw?.kind === "cohub.canvas.manifest" &&
			raw.version === 1 &&
			typeof raw.documentId === "string" &&
			typeof raw.title === "string"
		)
			return raw as CovasManifest;
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
const ITEM_BASE_KEYS = ["id", "type", "frame", "style", "metadata"] as const;

function frameFromNode(node: CanvasNodeRecord): CanvasItem["frame"] {
	return {
		x: node.x,
		y: node.y,
		width: node.width,
		height: node.height,
		rotation: node.rotation,
	};
}

function styleFromNode(node: CanvasNodeRecord): CanvasItem["style"] {
	return Object.keys(node.style ?? {}).length
		? (node.style as CanvasItem["style"])
		: undefined;
}

function refFromNode(node: CanvasNodeRecord): CanvasResourceItem["ref"] | null {
	if (node.refKind === "remote_url" && node.refUrl)
		return { kind: "remote-url", url: node.refUrl };
	if (node.refKind === "space_file" && node.refPath)
		return { kind: "space-file", path: node.refPath };
	return null;
}

export function canvasNodeToItem(node: CanvasNodeRecord): CanvasItem {
	const frame = frameFromNode(node);
	const style = styleFromNode(node);
	const data = (node.data ?? {}) as Record<string, unknown>;
	switch (node.type) {
		case "text":
			return {
				id: node.nodeId,
				type: "text",
				text: typeof data.text === "string" ? data.text : "Text",
				frame,
				style,
			};
		case "note":
			return {
				id: node.nodeId,
				type: "note",
				text: typeof data.text === "string" ? data.text : "",
				color: typeof data.color === "string" ? data.color : "brand",
				frame,
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
					typeof data.fillOpacity === "number" ? data.fillOpacity : 0.12,
				frame,
				style,
			};
		case "draw":
			return {
				id: node.nodeId,
				type: "draw",
				points: Array.isArray(data.points)
					? (data.points as CanvasDrawItem["points"])
					: [],
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 4,
				frame,
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
				}) as CanvasArrowItem["start"],
				end: (data.end ?? {
					kind: "point",
					x: 0,
					y: 0,
				}) as CanvasArrowItem["end"],
				bend: typeof data.bend === "number" ? data.bend : 0,
				color: typeof data.color === "string" ? data.color : "brand",
				size: typeof data.size === "number" ? data.size : 3,
				arrowStart: Boolean(data.arrowStart),
				arrowEnd: data.arrowEnd === undefined ? true : Boolean(data.arrowEnd),
				label: typeof data.label === "string" ? data.label : "",
				frame,
				style,
			};
		case "resource":
		case "file":
		case "url": {
			const ref = refFromNode(node);
			return {
				id: node.nodeId,
				type: "resource",
				ref: ref ?? { kind: "space-file", path: node.refPath || "missing" },
				snapshot: node.view as CanvasResourceSnapshot,
				frame,
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
			return {
				id: node.nodeId,
				type: UNKNOWN_CANVAS_ITEM_TYPE,
				frame,
				style,
				raw,
			};
		}
	}
}

/**
 * Map a canvas item to a server node input. Known shapes write their props into
 * the opaque `data` blob; unknown shapes reproduce their preserved fields so a
 * round-trip through this client is lossless.
 */
export function canvasItemToNode(
	item: CanvasItem,
	index: number,
): CanvasNodeInput {
	const base = {
		nodeId: item.id,
		parentId: null,
		orderKey: String(index).padStart(8, "0"),
		x: item.frame.x,
		y: item.frame.y,
		width: item.frame.width,
		height: item.frame.height,
		rotation: item.frame.rotation,
		style: item.style ?? {},
		animation: {},
	};
	const noRef = { refKind: null, refPath: null, refUrl: null } as const;

	// Unknown items (unrecognised or malformed) are reproduced from their
	// preserved record before any type-specific handling. The node type comes from
	// the real type stored in `raw`, not the reserved "unknown" discriminant.
	if (isUnknownItem(item)) {
		const data: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item.raw)) {
			if (!(ITEM_BASE_KEYS as readonly string[]).includes(key))
				data[key] = value;
		}
		return { ...base, ...noRef, type: unknownRealType(item), view: {}, data };
	}

	switch (item.type) {
		case "text":
			return {
				...base,
				...noRef,
				type: "text",
				view: {},
				data: { text: item.text },
			};
		case "note":
			return {
				...base,
				...noRef,
				type: "note",
				view: {},
				data: { text: item.text, color: item.color },
			};
		case "geo":
			return {
				...base,
				...noRef,
				type: "geo",
				view: {},
				data: {
					geo: item.geo,
					text: item.text,
					color: item.color,
					fillOpacity: item.fillOpacity,
				},
			};
		case "draw":
			return {
				...base,
				...noRef,
				type: "draw",
				view: {},
				data: { points: item.points, color: item.color, size: item.size },
			};
		case "arrow":
			return {
				...base,
				...noRef,
				type: "arrow",
				view: {},
				data: {
					start: item.start,
					end: item.end,
					bend: item.bend,
					color: item.color,
					size: item.size,
					arrowStart: item.arrowStart,
					arrowEnd: item.arrowEnd,
					label: item.label,
				},
			};
		case "resource": {
			const ref = item.ref;
			const isSpaceFile = ref.kind === "space-file";
			return {
				...base,
				type: isSpaceFile ? "file" : "url",
				refKind: isSpaceFile ? "space_file" : "remote_url",
				refPath: ref.kind === "space-file" ? ref.path : null,
				refUrl: ref.kind === "remote-url" ? ref.url : null,
				view: item.snapshot ?? {},
				data: {},
			};
		}
		default: {
			// Unreachable for validated items (unknowns are handled above); kept as a
			// defensive fallback that still preserves the item's opaque data.
			const fallback = item as { type: string; raw?: Record<string, unknown> };
			const data: Record<string, unknown> = {};
			const raw = fallback.raw ?? {};
			for (const [key, value] of Object.entries(raw)) {
				if (!(ITEM_BASE_KEYS as readonly string[]).includes(key))
					data[key] = value;
			}
			return { ...base, ...noRef, type: fallback.type, view: {}, data };
		}
	}
}

export function canvasBootstrapToDocument(input: {
	document: CanvasDocumentRecord;
	nodes: CanvasNodeRecord[];
}): CovasDocument {
	return CovasDocumentSchema.parse({
		kind: CANVAS_DOCUMENT_KIND,
		version: 1,
		appearance: DEFAULT_CANVAS_APPEARANCE,
		viewport: { x: 0, y: 0, zoom: 1 },
		items: input.nodes.map(canvasNodeToItem),
	});
}

function nodeInputToItem(node: CanvasNodeInput): CanvasItem {
	return canvasNodeToItem({
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

function nodePatch(before: CanvasNodeInput, after: CanvasNodeInput) {
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

export function diffCanvasDocuments(
	before: CovasDocument,
	after: CovasDocument,
): CanvasSemanticOp[] {
	const beforeNodes = new Map(
		before.items.map((item, index) => [item.id, canvasItemToNode(item, index)]),
	);
	const afterNodes = new Map(
		after.items.map((item, index) => [item.id, canvasItemToNode(item, index)]),
	);
	const ops: CanvasSemanticOp[] = [];
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
			ops.push({ type: "node.delete", payload: { nodeId }, inverse: { node } });
	}
	return ops;
}

export function invertCanvasOps(ops: CanvasSemanticOp[]): CanvasSemanticOp[] {
	return [...ops].reverse().map((op) => {
		if (op.type === "node.create") {
			const node = op.payload.node as CanvasNodeInput | undefined;
			return {
				type: "node.delete",
				payload: { nodeId: node?.nodeId },
				inverse: op.payload,
			};
		}
		if (op.type === "node.delete") {
			return {
				type: "node.create",
				payload: { node: op.inverse?.node },
				inverse: op.payload,
			};
		}
		return {
			type: "node.patch",
			payload: { nodeId: op.payload.nodeId, patch: op.inverse ?? {} },
			inverse: op.payload.patch as Record<string, unknown>,
		};
	});
}

export function applyCanvasOps(
	document: CovasDocument,
	ops: CanvasSemanticOp[],
): CovasDocument {
	let items = [...document.items];
	for (const op of ops) {
		if (op.type === "node.create") {
			const node = op.payload.node as CanvasNodeInput | undefined;
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
		const patch = op.payload.patch as Partial<CanvasNodeInput> | undefined;
		if (typeof nodeId !== "string" || !patch) continue;
		items = items.map((item, index) => {
			if (item.id !== nodeId) return item;
			return nodeInputToItem({
				...canvasItemToNode(item, index),
				...patch,
				nodeId,
			});
		});
	}
	return { ...document, items };
}

/**
 * Rebase local changes onto a remote document. `baseline` is the last document
 * the server is known to have; local changes are diffed against it and re-applied
 * on top of `remote`. Conflict policy follows applyCanvasOps: for a given node a
 * delete beats a concurrent patch, and local changes are applied last (so local
 * wins on same-field edits).
 */
export function rebaseOnRemote(
	baseline: CovasDocument,
	local: CovasDocument,
	remote: CovasDocument,
): { merged: CovasDocument; hadLocalChanges: boolean } {
	const localOps = diffCanvasDocuments(baseline, local);
	if (localOps.length === 0) return { merged: remote, hadLocalChanges: false };
	return { merged: applyCanvasOps(remote, localOps), hadLocalChanges: true };
}

/**
 * Reconcile an incoming external document with local state.
 * - Same-document refresh: rebase uncommitted local changes onto the remote
 *   document (see rebaseOnRemote).
 * - Document switch: adopt the new document as-is. The previous document's
 *   local changes belong to that document and must never leak into the new one.
 */
export function reconcileExternal(
	baseline: CovasDocument,
	local: CovasDocument,
	remote: CovasDocument,
	sameDocument: boolean,
): { merged: CovasDocument; hadLocalChanges: boolean } {
	if (!sameDocument) return { merged: remote, hadLocalChanges: false };
	return rebaseOnRemote(baseline, local, remote);
}
