import { parseBoardManifest } from "@cohub/protocol";
import type { BoardNodeInput, BoardOperation } from "@neta-art/cohub";
import {
	BOARD_DOCUMENT_KIND,
	BoardAppearanceSchema,
	type BoardConnection,
	type BoardDocument,
	BoardDocumentSchema,
	type BoardItem,
	boardNodeToItem,
	DEFAULT_BOARD_APPEARANCE,
	ITEM_BASE_KEYS,
	isRecord,
	isUnknownItem,
	sourceForItem,
	unknownRealType,
} from "@neta-art/cohub/board";
import { assignOrderKeys, sparseOrderKey } from "$lib/board/core/order-key";

export {
	boardBootstrapToDocument,
	boardNodeToItem,
	DEFAULT_BOARD_APPEARANCE,
} from "@neta-art/cohub/board";

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
		// Relations are part of the document's meaning, not decoration: omitting them
		// would make every manifest round-trip silently erase the graph.
		connections: document.connections,
	};
	return `${JSON.stringify(wire, null, 2)}\n`;
}

export { parseBoardManifest };

/**
 * Fields of an item record that are stored in dedicated node columns rather
 * than in the opaque `data` blob. When preserving an unknown item we keep
 * everything *except* these in `data`, and reconstruct them from the columns on
 * the way back — so an unrecognised shape round-trips through the server without
 * losing its custom fields.
 */

/**
 * Map a board item to a server node input. Known shapes patch their semantic
 * fields over the original wire record, preserving fields owned by newer
 * clients or another runtime.
 *
 * `orderKey` is supplied by the caller rather than derived from an index: it is a
 * property of the node's position *relative to its neighbours* (see
 * core/order-key), not of its array index, which is what keeps a delete from
 * re-keying the rest of the board.
 */
function boardItemToNodeWithKey(
	item: BoardItem,
	orderKey: string,
): BoardNodeInput {
	const source = sourceForItem(item);
	const base = {
		nodeId: item.id,
		parentId: source?.parentId ?? null,
		orderKey,
		x: item.frame.x,
		y: item.frame.y,
		width: item.frame.width,
		height: item.frame.height,
		rotation: item.frame.rotation,
		style: item.style ?? source?.style ?? {},
	};
	const preservedRef = {
		refKind: source?.refKind ?? null,
		refPath: source?.refPath ?? null,
		refUrl: source?.refUrl ?? null,
	};
	const preservedView = source?.view ?? {};
	const dataWith = (
		fields: Record<string, unknown>,
		remove: readonly string[] = [],
	) => {
		const data = { ...(source?.data ?? {}), ...fields };
		for (const key of remove) delete data[key];
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
				data: dataWith(
					{
						text: item.text,
						color: item.color,
						fontSize: item.fontSize,
					},
					["autoSize"],
				),
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
		case "file":
			return {
				...base,
				type: "file",
				refKind: "space_file",
				refPath: item.ref.path,
				// A cover URL is display data, never a node ref: the server rejects
				// network URLs in refUrl, and the ref must stay the workspace file.
				refUrl: null,
				view: { ...preservedView, ...(item.snapshot ?? {}) },
				data: dataWith({}),
			};
		case "task":
			return {
				...base,
				type: "task",
				refKind: null,
				refPath: null,
				refUrl: null,
				view: { ...preservedView, ...item.snapshot },
				data: dataWith({ taskRunId: item.taskRunId }),
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

/**
 * Map an item to a node input, keeping whatever order key it already carries.
 * Used for the *before* side of a diff (which must reproduce what the server
 * currently holds) and by callers that only need the node's other fields.
 *
 * `count` sizes the fallback key for items that have never been synced, so a run
 * of them lands at one width. Mixed widths would not sort lexicographically.
 */
export function boardItemToNode(
	item: BoardItem,
	index: number,
	count = index + 1,
): BoardNodeInput {
	const existing = sourceForItem(item)?.orderKey;
	return boardItemToNodeWithKey(item, existing ?? sparseOrderKey(index, count));
}

function nodeInputToItem(node: BoardNodeInput): BoardItem {
	return boardNodeToItem({
		boardId: "",
		version: 0,
		createdAt: null,
		updatedAt: null,
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

/**
 * Diff two documents into board operations.
 *
 * Node conversion is the expensive part (it rebuilds every node's wire record and
 * JSON-compares it), so unchanged items skip it entirely: the editor updates state
 * immutably, which means an item untouched by an edit is still the *same object*.
 * A drag among ten thousand nodes therefore converts only the nodes that moved,
 * instead of the whole document twice.
 *
 * Order keys are minted between neighbours (see core/order-key), so membership
 * changes no longer force a rewrite: deleting a node emits one delete, and an
 * append emits one create. Only nodes whose key genuinely had to move are
 * converted. Losing the identity fast path (e.g. if a caller deep-clones items)
 * costs time, never correctness.
 */
export function diffBoardDocuments(
	before: BoardDocument,
	after: BoardDocument,
): BoardOperation[] {
	const beforeById = new Map<string, { item: BoardItem; index: number }>();
	before.items.forEach((item, index) => {
		beforeById.set(item.id, { item, index });
	});

	// Resolve the target order keys once for the whole document. Existing keys are
	// kept wherever they already express the requested order, so this returns only
	// the nodes that actually have to be re-keyed — usually none.
	const keyOf = (index: number) =>
		sourceForItem(after.items[index] as BoardItem)?.orderKey ?? null;
	const rekeyed = assignOrderKeys(
		after.items.length,
		(index) => (after.items[index] as BoardItem).id,
		keyOf,
	);

	const beforeConnections = new Map(
		before.connections.map((connection) => [connection.id, connection]),
	);
	const afterConnectionIds = new Set(
		after.connections.map((connection) => connection.id),
	);

	const ops: BoardOperation[] = [];

	// The server validates in operation order, and the two referential rules are
	// mirror images: a relation may not outlive its node, and may not precede it.
	// So relation removals come first, node changes next, relation additions last.
	// Getting this wrong makes an otherwise legal edit fail with NODE_REFERENCED
	// or INVALID_REFERENCE.

	// 1. Relations that are going away, before the nodes they name can vanish.
	for (const [connectionId, previous] of beforeConnections) {
		if (afterConnectionIds.has(connectionId)) continue;
		ops.push({
			type: "connection.delete",
			payload: { connectionId, reason: "user-delete" },
			inverse: { connection: previous },
		});
	}

	// 2. Nodes: creates, patches, then deletes.
	const seen = new Set<string>();
	after.items.forEach((item, index) => {
		seen.add(item.id);
		const rekey = rekeyed.get(item.id);
		const orderKey =
			rekey ?? keyOf(index) ?? sparseOrderKey(index, after.items.length);
		const previous = beforeById.get(item.id);
		if (!previous) {
			ops.push({
				type: "node.create",
				payload: { node: boardItemToNodeWithKey(item, orderKey) },
				inverse: { nodeId: item.id },
			});
			return;
		}
		// Same object and same key: provably identical wire record, skip conversion.
		if (previous.item === item && rekey === undefined) return;
		const diff = nodePatch(
			boardItemToNode(previous.item, previous.index, before.items.length),
			boardItemToNodeWithKey(item, orderKey),
		);
		if (diff)
			ops.push({
				type: "node.patch",
				payload: { nodeId: item.id, patch: diff.patch },
				inverse: diff.inverse,
			});
	});

	for (const [nodeId, previous] of beforeById) {
		if (seen.has(nodeId)) continue;
		ops.push({
			type: "node.delete",
			payload: { nodeId, reason: "user-delete" },
			inverse: {
				node: boardItemToNode(
					previous.item,
					previous.index,
					before.items.length,
				),
			},
		});
	}

	// 3. Relations that changed or appeared, once their nodes certainly exist.
	for (const connection of after.connections) {
		const previous = beforeConnections.get(connection.id);
		if (!previous) {
			ops.push({
				type: "connection.create",
				payload: { connection },
				inverse: { connectionId: connection.id },
			});
			continue;
		}
		// Identity check first: an untouched relation costs one reference compare.
		if (previous === connection) continue;
		const patch = connectionPatch(previous, connection);
		if (patch)
			ops.push({
				type: "connection.patch",
				payload: { connectionId: connection.id, patch },
				inverse: { connection: previous },
			});
	}

	return ops;
}

/** Changed fields of a connection, or null when nothing changed. */
function connectionPatch(
	before: BoardConnection,
	after: BoardConnection,
): Partial<BoardConnection> | null {
	const patch: Record<string, unknown> = {};
	const compare = <K extends keyof BoardConnection>(key: K) => {
		const a = before[key];
		const b = after[key];
		// Structural compare: anchors, routing and style are small nested objects,
		// and JSON order is stable because they all come from the same schema.
		if (JSON.stringify(a) !== JSON.stringify(b)) patch[key as string] = b;
	};
	compare("source");
	compare("target");
	compare("relation");
	compare("direction");
	compare("label");
	compare("routing");
	compare("style");
	compare("metadata");
	return Object.keys(patch).length > 0
		? (patch as Partial<BoardConnection>)
		: null;
}

/**
 * Strip the client-only fields from operations before sending them to the server.
 *
 * `inverse` exists so undo can be computed locally and is discarded server-side,
 * but it is by far the largest part of an operation: on a delete it is the entire
 * node record, which made the wire payload ~5x bigger than the information it
 * carried. It also counts against the server's per-transaction byte cap, so
 * sending it made large edits fail sooner for no benefit.
 */
export function toWireOperations(ops: BoardOperation[]): BoardOperation[] {
	return ops.map(({ inverse: _inverse, ...rest }) => rest as BoardOperation);
}

export function invertBoardOps(ops: BoardOperation[]): BoardOperation[] {
	const inverseOps: BoardOperation[] = [];
	for (const op of [...ops].reverse()) {
		if (op.type === "board.patch") {
			const previous = isRecord(op.inverse?.patch) ? op.inverse.patch : {};
			inverseOps.push({
				type: "board.patch",
				payload: { patch: previous },
				inverse: { patch: op.payload.patch },
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
		if (op.type === "node.patch") {
			inverseOps.push({
				type: "node.patch",
				payload: {
					nodeId: op.payload.nodeId,
					patch: op.inverse ?? {},
				},
				inverse: op.payload.patch,
			});
			continue;
		}
		if (op.type === "connection.create") {
			inverseOps.push({
				type: "connection.delete",
				payload: { connectionId: op.payload.connection.id },
				inverse: { connection: op.payload.connection },
			});
			continue;
		}
		if (op.type === "connection.delete") {
			const connection = op.inverse?.connection;
			if (!connection) continue;
			inverseOps.push({
				type: "connection.create",
				payload: { connection: connection as BoardConnection },
				inverse: { connectionId: op.payload.connectionId },
			});
			continue;
		}
		if (op.type === "connection.patch") {
			// Undoing a patch restores the whole prior record rather than inverting
			// field by field, which is what makes an undo of a multi-field edit land
			// in one step.
			const previous = op.inverse?.connection as BoardConnection | undefined;
			if (!previous) continue;
			inverseOps.push({
				type: "connection.patch",
				payload: { connectionId: op.payload.connectionId, patch: previous },
				inverse: { connection: previous },
			});
		}
	}
	return inverseOps;
}

export function applyBoardOps(
	document: BoardDocument,
	ops: BoardOperation[],
): BoardDocument {
	let items = [...document.items];
	let connections = [...document.connections];
	let appearance = document.appearance;
	for (const op of ops) {
		if (op.type === "board.patch") {
			const parsed = BoardAppearanceSchema.safeParse(
				op.payload.patch.metadata?.appearance,
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
		if (op.type === "connection.create") {
			const connection = op.payload.connection as BoardConnection | undefined;
			if (
				connection &&
				!connections.some((existing) => existing.id === connection.id)
			)
				connections = [...connections, connection];
			continue;
		}
		if (op.type === "connection.delete") {
			const connectionId = op.payload.connectionId;
			if (typeof connectionId === "string")
				connections = connections.filter(
					(connection) => connection.id !== connectionId,
				);
			continue;
		}
		if (op.type === "connection.patch") {
			const connectionId = op.payload.connectionId;
			const patch = op.payload.patch as Partial<BoardConnection> | undefined;
			if (typeof connectionId !== "string" || !patch) continue;
			connections = connections.map((connection) =>
				connection.id === connectionId
					? { ...connection, ...patch, id: connectionId }
					: connection,
			);
			continue;
		}
		if (op.type !== "node.patch") continue;
		const nodeId = op.payload.nodeId;
		const patch = op.payload.patch as Partial<BoardNodeInput> | undefined;
		if (typeof nodeId !== "string" || !patch) continue;
		items = items.map((item, index) => {
			if (item.id !== nodeId) return item;
			return nodeInputToItem({
				...boardItemToNode(item, index, items.length),
				...patch,
				nodeId,
			});
		});
	}
	// A rebase can land a relation whose node was concurrently deleted; dropping it
	// here keeps the merged document internally valid instead of deferring a
	// guaranteed server rejection.
	const nodeIds = new Set(items.map((item) => item.id));
	const reachable = connections.filter(
		(connection) =>
			nodeIds.has(connection.source.nodeId) &&
			nodeIds.has(connection.target.nodeId),
	);
	return { ...document, appearance, items, connections: reachable };
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
