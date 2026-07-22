import { createCanvasItemId } from "$lib/canvas/canvas-id";
import { getResourceTitle, inferMediaKind } from "$lib/canvas/canvas-media";
import type {
	CanvasArrowItem,
	CanvasFrame,
	CanvasImageItem,
	CanvasItem,
	CanvasItemStyle,
	CanvasMediaSnapshot,
	CanvasVideoItem,
} from "$lib/canvas/canvas-schema";
import { unknownRealType } from "$lib/canvas/canvas-schema";
import { computeDrawBounds } from "$lib/canvas/core/draw-geometry";

const DEFAULT_MEDIA_SIZE = { width: 320, height: 200 };
/** Empty autosize text starts as a single-line caret box. */
const DEFAULT_TEXT_SIZE = { width: 24, height: 28 };
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
	size = DEFAULT_MEDIA_SIZE,
): CanvasFrame {
	return { x, y, width: size.width, height: size.height, rotation: 0 };
}

/**
 * Fit media into a max edge while preserving aspect. Falls back to the default
 * media size when intrinsic dimensions are unknown.
 */
export function mediaFrameSize(
	naturalWidth?: number | null,
	naturalHeight?: number | null,
	maxEdge = 480,
): { width: number; height: number } {
	if (
		!naturalWidth ||
		!naturalHeight ||
		!Number.isFinite(naturalWidth) ||
		!Number.isFinite(naturalHeight) ||
		naturalWidth <= 0 ||
		naturalHeight <= 0
	) {
		return { ...DEFAULT_MEDIA_SIZE };
	}
	const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight));
	return {
		width: Math.max(24, naturalWidth * scale),
		height: Math.max(24, naturalHeight * scale),
	};
}

function mediaSnapshot(
	path: string,
	snapshot?: CanvasMediaSnapshot,
): CanvasMediaSnapshot {
	return {
		title: snapshot?.title ?? getResourceTitle(path),
		mimeType: snapshot?.mimeType,
		size: snapshot?.size,
		mtimeMs: snapshot?.mtimeMs,
		naturalWidth: snapshot?.naturalWidth,
		naturalHeight: snapshot?.naturalHeight,
	};
}

export function createImageCanvasItem(
	path: string,
	x: number,
	y: number,
	snapshot?: CanvasMediaSnapshot,
): CanvasImageItem {
	const size = mediaFrameSize(snapshot?.naturalWidth, snapshot?.naturalHeight);
	return {
		id: createCanvasItemId(),
		type: "image",
		ref: { kind: "space-file", path },
		snapshot: mediaSnapshot(path, snapshot),
		frame: createFrame(x - size.width / 2, y - size.height / 2, size),
	};
}

export function createVideoCanvasItem(
	path: string,
	x: number,
	y: number,
	snapshot?: CanvasMediaSnapshot,
): CanvasVideoItem {
	const size = mediaFrameSize(snapshot?.naturalWidth, snapshot?.naturalHeight);
	return {
		id: createCanvasItemId(),
		type: "video",
		ref: { kind: "space-file", path },
		snapshot: mediaSnapshot(path, {
			...snapshot,
			mimeType: snapshot?.mimeType ?? "video/*",
		}),
		frame: createFrame(x - size.width / 2, y - size.height / 2, size),
	};
}

/**
 * Create an image or video node from a space file path. Non-media files return
 * null so callers can refuse rather than create a broken node.
 */
export function createMediaCanvasItem(
	path: string,
	x: number,
	y: number,
	snapshot?: CanvasMediaSnapshot,
): CanvasImageItem | CanvasVideoItem | null {
	const kind = inferMediaKind(path, snapshot?.mimeType);
	if (kind === "image") return createImageCanvasItem(path, x, y, snapshot);
	if (kind === "video") return createVideoCanvasItem(path, x, y, snapshot);
	return null;
}

export function createTextCanvasItem(
	text: string,
	x: number,
	y: number,
	color = "neutral",
): CanvasItem {
	// Anchor at the caret point (top-left of the first line).
	return {
		id: createCanvasItemId(),
		type: "text",
		text,
		color,
		autoSize: true,
		frame: createFrame(x, y, DEFAULT_TEXT_SIZE),
	};
}

const DEFAULT_NOTE_SIZE = { width: 200, height: 200 };
const DEFAULT_GEO_SIZE = { width: 200, height: 140 };

export function createNoteCanvasItem(
	x: number,
	y: number,
	color = "amber",
	text = "",
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "note",
		text,
		color,
		frame: createFrame(
			x - DEFAULT_NOTE_SIZE.width / 2,
			y - DEFAULT_NOTE_SIZE.height / 2,
			DEFAULT_NOTE_SIZE,
		),
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
		fillOpacity: 0,
		frame: createFrame(
			x - DEFAULT_GEO_SIZE.width / 2,
			y - DEFAULT_GEO_SIZE.height / 2,
			DEFAULT_GEO_SIZE,
		),
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
		size: 2.5,
		arrowStart: false,
		arrowEnd: true,
		label: "",
		frame,
	};
}

const DEFAULT_FRAME_SIZE = { width: 480, height: 320 };

export function createFrameCanvasItem(
	x: number,
	y: number,
	color = "neutral",
	label = "Frame",
): CanvasItem {
	return {
		id: createCanvasItemId(),
		type: "frame",
		label,
		color,
		frame: createFrame(
			x - DEFAULT_FRAME_SIZE.width / 2,
			y - DEFAULT_FRAME_SIZE.height / 2,
			DEFAULT_FRAME_SIZE,
		),
	};
}

function arrowFrameFromPoints(
	start: { x: number; y: number },
	end: { x: number; y: number },
): CanvasFrame {
	const pad = 16;
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

/**
 * Create a copy of an item with a fresh id. Pass `offset` (defaults to
 * DUPLICATE_OFFSET) to displace the copy; pass 0 for an in-place clone used by
 * Alt-drag (the subsequent drag provides the visual offset).
 */
export function duplicateCanvasItem(
	item: CanvasItem,
	offset = DUPLICATE_OFFSET,
): CanvasItem {
	const frame: CanvasFrame = {
		...item.frame,
		x: item.frame.x + offset,
		y: item.frame.y + offset,
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
						x: endpoint.x + offset,
						y: endpoint.y + offset,
					}
				: endpoint;
		return {
			...structuredClone(item),
			id: createCanvasItemId(),
			locked: false,
			start: move(item.start),
			end: move(item.end),
			frame,
		};
	}
	return {
		...structuredClone(item),
		id: createCanvasItemId(),
		locked: false,
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
			return item.text.split("\n")[0] || "Text";
		case "note":
			return item.text.split("\n")[0] || "Note";
		case "geo":
			return item.text.split("\n")[0] || item.geo;
		case "draw":
			return "Drawing";
		case "arrow":
			return item.label || "Arrow";
		case "frame":
			return item.label || "Frame";
		case "image":
		case "video":
			return item.snapshot?.title ?? getResourceTitle(item.ref.path);
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
		case "frame":
			return "Frame";
		case "image":
			return "Image";
		case "video":
			return "Video";
		default:
			return unknownRealType(item);
	}
}
