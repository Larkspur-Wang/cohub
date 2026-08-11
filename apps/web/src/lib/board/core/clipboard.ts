/**
 * Board clipboard — serialise / deserialise a selection for copy-paste.
 *
 * External clipboard payloads are untrusted: size, item count, per-item schema
 * and id uniqueness are validated before anything is materialised. Failures
 * return null so the paste path can fall back cleanly.
 */

import { BOARD_CLIPBOARD_KIND, BOARD_CLIPBOARD_MIME } from "@cohub/protocol";
import {
	type BoardConnection,
	BoardConnectionSchema,
	type BoardItem,
	isUnknownItem,
	KNOWN_BOARD_ITEM_TYPES,
	parseBoardItemLoose,
	selectionBounds,
} from "@neta-art/cohub/board";
import { createBoardItemId } from "$lib/board/board-id";
import { DUPLICATE_OFFSET } from "$lib/board/board-items";

export { BOARD_CLIPBOARD_MIME };
export const BOARD_CLIPBOARD_VERSION = 1 as const;

/**
 * Cap at the server per-transaction op limit so a paste of new nodes always
 * fits in a single commit (avoids local success then persistent 413).
 */
export const MAX_CLIPBOARD_ITEMS = 100;
/** Reject clipboard JSON larger than this (chars). */
export const MAX_CLIPBOARD_CHARS = 256 * 1024;

export type BoardClipboardPayload = {
	kind: typeof BOARD_CLIPBOARD_KIND;
	version: typeof BOARD_CLIPBOARD_VERSION;
	items: BoardItem[];
	/**
	 * Relations *between the copied nodes*.
	 *
	 * Carried so copying a connected group reproduces its structure, not just its
	 * shapes. Relations to nodes outside the selection are deliberately excluded:
	 * a pasted copy pointing back at the original would be a relation the user
	 * never drew.
	 */
	connections: BoardConnection[];
	origin: { x: number; y: number };
};

export function encodeClipboard(
	items: BoardItem[],
	connections: readonly BoardConnection[] = [],
): BoardClipboardPayload | null {
	if (items.length === 0) return null;
	if (items.length > MAX_CLIPBOARD_ITEMS) return null;
	const bounds = selectionBounds(items.map((item) => item.frame));
	if (!bounds) return null;
	const origin = { x: bounds.x, y: bounds.y };
	const copied = new Set(items.map((item) => item.id));
	return {
		kind: BOARD_CLIPBOARD_KIND,
		version: BOARD_CLIPBOARD_VERSION,
		items: items.map((item) => shiftItem(item, -origin.x, -origin.y)),
		connections: connections.filter(
			(connection) =>
				copied.has(connection.source.nodeId) &&
				copied.has(connection.target.nodeId),
		),
		origin,
	};
}

/**
 * Parse and validate a clipboard payload. Returns null on any structural or
 * size failure — never throws, never returns half-validated data.
 */
export function parseClipboard(raw: unknown): BoardClipboardPayload | null {
	if (raw == null) return null;
	if (typeof raw === "string") {
		if (raw.length > MAX_CLIPBOARD_CHARS) return null;
		try {
			raw = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	if (record.kind !== BOARD_CLIPBOARD_KIND) return null;
	if (record.version !== BOARD_CLIPBOARD_VERSION) return null;
	if (!Array.isArray(record.items) || record.items.length === 0) return null;
	if (record.items.length > MAX_CLIPBOARD_ITEMS) return null;

	const originRaw = record.origin;
	if (!originRaw || typeof originRaw !== "object") return null;
	const ox = (originRaw as { x?: unknown }).x;
	const oy = (originRaw as { y?: unknown }).y;
	if (typeof ox !== "number" || !Number.isFinite(ox)) return null;
	if (typeof oy !== "number" || !Number.isFinite(oy)) return null;

	const items: BoardItem[] = [];
	const seenIds = new Set<string>();
	for (const entry of record.items) {
		// Reject non-objects before lenient parse (which would invent fallbacks).
		if (!entry || typeof entry !== "object") return null;
		const entryRecord = entry as Record<string, unknown>;
		if (typeof entryRecord.id !== "string" || !entryRecord.id) return null;
		if (typeof entryRecord.type !== "string" || !entryRecord.type) return null;
		if (seenIds.has(entryRecord.id)) return null;
		seenIds.add(entryRecord.id);

		const item = parseBoardItemLoose(entry);
		// Malformed known types degrade to unknown — reject those for clipboard.
		// Intentional forward-compat unknowns (real type outside this client's set)
		// are allowed when they still carry a stable id and type string.
		if (isUnknownItem(item)) {
			const real = item.raw.type;
			if (typeof real !== "string" || !real || real === "unknown") return null;
			if (item.id === "unknown") return null;
			// A known type that failed schema validation is not pasteable content.
			if ((KNOWN_BOARD_ITEM_TYPES as readonly string[]).includes(real))
				return null;
		}
		if (
			!Number.isFinite(item.frame.width) ||
			!Number.isFinite(item.frame.height)
		)
			return null;
		items.push(item);
	}
	if (items.length === 0) return null;

	// Connections are optional on the wire but strictly validated when present: a
	// relation is pure reference, so one that fails its schema or names a node
	// outside the payload is dropped rather than pasted as a dangling edge.
	const connections: BoardConnection[] = [];
	if (record.connections !== undefined) {
		if (!Array.isArray(record.connections)) return null;
		if (record.connections.length > MAX_CLIPBOARD_ITEMS) return null;
		const ids = new Set(items.map((item) => item.id));
		const seenConnectionIds = new Set<string>();
		for (const entry of record.connections) {
			const parsed = BoardConnectionSchema.safeParse(entry);
			if (!parsed.success) return null;
			const connection = parsed.data;
			if (seenConnectionIds.has(connection.id)) return null;
			seenConnectionIds.add(connection.id);
			if (
				!ids.has(connection.source.nodeId) ||
				!ids.has(connection.target.nodeId)
			)
				continue;
			connections.push(connection);
		}
	}

	return {
		kind: BOARD_CLIPBOARD_KIND,
		version: BOARD_CLIPBOARD_VERSION,
		items,
		connections,
		origin: { x: ox, y: oy },
	};
}

/**
 * Materialise clipboard content: fresh ids, world offset, and relations rewired
 * onto the new nodes.
 *
 * Both items and connections get new identities, and every endpoint is remapped
 * through the same id map, so a pasted group is structurally identical to the
 * original while sharing nothing with it.
 */
export function materializeClipboard(
	payload: BoardClipboardPayload,
	at: { x: number; y: number },
): { items: BoardItem[]; connections: BoardConnection[] } {
	const idMap = new Map<string, string>();
	for (const item of payload.items) idMap.set(item.id, createBoardItemId());
	const items = payload.items.map((item) => {
		const nextId = idMap.get(item.id) ?? createBoardItemId();
		const shifted = shiftItem(item, at.x, at.y);
		return { ...shifted, id: nextId, locked: false };
	});
	const connections = (payload.connections ?? []).flatMap((connection) => {
		const source = idMap.get(connection.source.nodeId);
		const target = idMap.get(connection.target.nodeId);
		if (!source || !target) return [];
		return [
			{
				...connection,
				id: createBoardItemId(),
				source: { ...connection.source, nodeId: source },
				target: { ...connection.target, nodeId: target },
			},
		];
	});
	return { items, connections };
}

export function defaultPasteOffset(count = 1) {
	return { x: DUPLICATE_OFFSET * count, y: DUPLICATE_OFFSET * count };
}

function shiftItem(item: BoardItem, dx: number, dy: number): BoardItem {
	const frame = { ...item.frame, x: item.frame.x + dx, y: item.frame.y + dy };
	if (item.type === "arrow") {
		return {
			...item,
			frame,
			start: { x: item.start.x + dx, y: item.start.y + dy },
			end: { x: item.end.x + dx, y: item.end.y + dy },
		};
	}
	return { ...item, frame };
}
