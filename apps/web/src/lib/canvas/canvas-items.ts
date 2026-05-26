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

export function patchItemFrame(
	items: CanvasItem[],
	id: string,
	frame: CanvasFrame,
) {
	return items.map((item) => (item.id === id ? { ...item, frame } : item));
}

export function removeCanvasItem(items: CanvasItem[], id: string) {
	return items.filter((item) => item.id !== id);
}
