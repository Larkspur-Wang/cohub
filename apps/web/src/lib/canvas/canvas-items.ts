import { createCanvasItemId } from "$lib/canvas/canvas-id";
import { getResourceTitle, inferMediaKind } from "$lib/canvas/canvas-media";
import type {
	CanvasArrowItem,
	CanvasFrame,
	CanvasItem,
	CanvasItemStyle,
	CanvasResourceSnapshot,
} from "$lib/canvas/canvas-schema";
import { unknownRealType } from "$lib/canvas/canvas-schema";
import { computeDrawBounds } from "$lib/canvas/core/draw-geometry";

const DEFAULT_RESOURCE_SIZE = { width: 280, height: 180 };
const DEFAULT_TEXT_SIZE = { width: 260, height: 140 };
/** Offset applied when duplicating so the copy is visibly displaced. */
export const DUPLICATE_OFFSET = 24;

export const DEFAULT_CANVAS_ITEM_STYLE: CanvasItemStyle = {
	variant: "default",
	size: "md",
	emphasis: "normal",
	effects: [],
};

function createFrame(
	x: number,
	y: number,
	size = DEFAULT_RESOURCE_SIZE,
): CanvasFrame {
	return { x, y, width: size.width, height: size.height, rotation: 0 };
}

export function createSpaceFileCanvasItem(
	path: string,
	x: number,
	y: number,
	snapshot?: CanvasResourceSnapshot,
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "resource",
		ref: { kind: "space-file", path },
		snapshot: {
			title: snapshot?.title ?? getResourceTitle(path),
			mimeType: snapshot?.mimeType,
			size: snapshot?.size,
			mtimeMs: snapshot?.mtimeMs,
		},
		frame: createFrame(x, y),
		style: { ...DEFAULT_CANVAS_ITEM_STYLE },
	};
}

export function createRemoteUrlCanvasItem(
	url: string,
	x: number,
	y: number,
): CanvasItem {
	const title = getResourceTitle(url);
	return {
		id: createCanvasItemId(),
		type: "resource",
		ref: { kind: "remote-url", url },
		snapshot: {
			title,
			mimeType: inferMediaKind(url) === "image" ? "image/*" : undefined,
		},
		frame: createFrame(x, y),
		style: { ...DEFAULT_CANVAS_ITEM_STYLE },
	};
}

export function createTextCanvasItem(
	text: string,
	x: number,
	y: number,
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "text",
		text,
		frame: createFrame(x, y, DEFAULT_TEXT_SIZE),
		style: { ...DEFAULT_CANVAS_ITEM_STYLE },
	};
}

const DEFAULT_NOTE_SIZE = { width: 200, height: 200 };
const DEFAULT_GEO_SIZE = { width: 200, height: 140 };

export function createNoteCanvasItem(
	x: number,
	y: number,
	color = "brand",
	text = "",
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "note",
		text,
		color,
		frame: createFrame(x, y, DEFAULT_NOTE_SIZE),
	};
}

export function createGeoCanvasItem(
	geo: string,
	x: number,
	y: number,
	color = "brand",
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "geo",
		geo,
		text: "",
		color,
		fillOpacity: 0.12,
		frame: createFrame(x, y, DEFAULT_GEO_SIZE),
	};
}

/**
 * Create a freehand draw item from raw world-space samples. The frame is the
 * stroke's padded bounds; points are stored relative to the frame origin so a
 * translate moves the whole stroke by patching the frame alone.
 */
export function createDrawCanvasItem(
	worldPoints: Array<{ x: number; y: number; p: number }>,
	color: string,
	size: number,
): CanvasItem {
	const bounds = computeDrawBounds(worldPoints, size);
	const points = worldPoints.map((point) => ({
		x: point.x - bounds.x,
		y: point.y - bounds.y,
		p: point.p,
	}));
	return {
		id: createCanvasItemId(),
		type: "draw",
		points,
		color,
		size,
		frame: {
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: bounds.height,
			rotation: 0,
		},
	};
}

/**
 * Create an arrow between two world points. `startBinding`/`endBinding` upgrade
 * an endpoint to a binding when the arrow was drawn from/onto a shape.
 */
export function createArrowCanvasItem(
	start: { x: number; y: number },
	end: { x: number; y: number },
	color: string,
	startBinding?: CanvasArrowItem["start"],
	endBinding?: CanvasArrowItem["end"],
): CanvasItem {
	const startX = startBinding ?? { kind: "point", x: start.x, y: start.y };
	const endX = endBinding ?? { kind: "point", x: end.x, y: end.y };
	const frame = arrowFrameFromPoints(start, end);
	return {
		id: createCanvasItemId(),
		type: "arrow",
		start: startX,
		end: endX,
		bend: 0,
		color,
		size: 3,
		arrowStart: false,
		arrowEnd: true,
		label: "",
		frame,
	};
}

function arrowFrameFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
): CanvasFrame {
	const pad = 12;
	const x = Math.min(start.x, end.x) - pad;
	const y = Math.min(start.y, end.y) - pad;
	return {
		x,
		y,
		width: Math.max(1, Math.abs(end.x - start.x) + pad * 2),
		height: Math.max(1, Math.abs(end.y - start.y) + pad * 2),
		rotation: 0,
	};
}

/** Create a copy of an item with a fresh id and a small positional offset. */
export function duplicateCanvasItem(item: CanvasItem): CanvasItem {
	const frame: CanvasFrame = {
		...item.frame,
		x: item.frame.x + DUPLICATE_OFFSET,
		y: item.frame.y + DUPLICATE_OFFSET,
	};
	// An arrow's geometry lives in its endpoints, so offset its free endpoints
	// too (bindings stay attached); the editor recomputes an exact frame afterwards.
	if (item.type === "arrow") {
		const move = (
			endpoint: CanvasArrowItem["start"],
		): CanvasArrowItem["start"] =>
			endpoint.kind === "point"
				? {
						kind: "point",
						x: endpoint.x + DUPLICATE_OFFSET,
						y: endpoint.y + DUPLICATE_OFFSET,
					}
				: endpoint;
		return {
			...structuredClone(item),
			id: createCanvasItemId(),
			start: move(item.start),
			end: move(item.end),
			frame,
		};
	}
	return {
		...structuredClone(item),
		id: createCanvasItemId(),
		frame,
	};
}

export function patchItemFrame(
	items: CanvasItem[],
	id: string,
	frame: CanvasFrame,
) {
	return items.map((item) => (item.id === id ? { ...item, frame } : item));
}

/** Apply a frame patch to many items at once, keyed by id. */
export function patchItemFrames(
	items: CanvasItem[],
	frames: Map<string, CanvasFrame>,
) {
	if (frames.size === 0) return items;
	return items.map((item) => {
		const frame = frames.get(item.id);
		return frame ? { ...item, frame } : item;
	});
}

export function removeCanvasItem(items: CanvasItem[], id: string) {
	return items.filter((item) => item.id !== id);
}

export function removeCanvasItems(items: CanvasItem[], ids: Set<string>) {
	if (ids.size === 0) return items;
	return items.filter((item) => !ids.has(item.id));
}

// ─── Labels ─────────────────────────────────────────────────────────

export function titleForCanvasItem(item: CanvasItem): string {
	switch (item.type) {
		case "text":
			return item.text.split("\n")[0] || "Text note";
		case "note":
			return item.text.split("\n")[0] || "Note";
		case "geo":
			return item.text.split("\n")[0] || item.geo;
		case "draw":
			return "Drawing";
		case "arrow":
			return item.label || "Arrow";
		case "resource":
			return (
				item.snapshot?.title ??
				(item.ref.kind === "space-file"
					? getResourceTitle(item.ref.path)
					: getResourceTitle(item.ref.url))
			);
		default:
			return unknownRealType(item);
	}
}

export function subtitleForCanvasItem(item: CanvasItem): string {
	switch (item.type) {
		case "text":
			return "Text";
		case "note":
			return "Note";
		case "geo":
			return item.geo;
		case "draw":
			return "Drawing";
		case "arrow":
			return "Arrow";
		case "resource": {
			const value =
				item.ref.kind === "space-file" ? item.ref.path : item.ref.url;
			const kind = inferMediaKind(value, item.snapshot?.mimeType);
			return item.ref.kind === "space-file"
				? `${kind} · Space file`
				: `${kind} · Remote URL`;
		}
		default:
			return unknownRealType(item);
	}
}
