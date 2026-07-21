import { createCanvasItemId } from "$lib/canvas/canvas-id";
import { getResourceTitle, inferMediaKind } from "$lib/canvas/canvas-media";
import type {
	CanvasFrame,
	CanvasItem,
	CanvasItemStyle,
	CanvasResourceSnapshot,
} from "$lib/canvas/canvas-schema";

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

/** Create a copy of an item with a fresh id and a small positional offset. */
export function duplicateCanvasItem(item: CanvasItem): CanvasItem {
	const frame: CanvasFrame = {
		...item.frame,
		x: item.frame.x + DUPLICATE_OFFSET,
		y: item.frame.y + DUPLICATE_OFFSET,
	};
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
	if (item.type === "text") return item.text.split("\n")[0] || "Text note";
	return (
		item.snapshot?.title ??
		(item.ref.kind === "space-file"
			? getResourceTitle(item.ref.path)
			: getResourceTitle(item.ref.url))
	);
}

export function subtitleForCanvasItem(item: CanvasItem): string {
	if (item.type === "text") return "Text";
	const value = item.ref.kind === "space-file" ? item.ref.path : item.ref.url;
	const kind = inferMediaKind(value, item.snapshot?.mimeType);
	return item.ref.kind === "space-file"
		? `${kind} · Space file`
		: `${kind} · Remote URL`;
}
