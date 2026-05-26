import { clampZoom } from "$lib/canvas/canvas-geometry";
import { patchItemFrame, removeCanvasItem } from "$lib/canvas/canvas-items";
import type {
	CanvasFrame,
	CanvasItem,
	CovasDocument,
} from "$lib/canvas/canvas-schema";

export function addCanvasItem(
	document: CovasDocument,
	item: CanvasItem,
): CovasDocument {
	return { ...document, items: [...document.items, item] };
}

export function moveCanvasItem(
	document: CovasDocument,
	id: string,
	frame: CanvasFrame,
): CovasDocument {
	return { ...document, items: patchItemFrame(document.items, id, frame) };
}

export function deleteCanvasItem(
	document: CovasDocument,
	id: string,
): CovasDocument {
	return { ...document, items: removeCanvasItem(document.items, id) };
}

export function setCanvasViewport(
	document: CovasDocument,
	viewport: CovasDocument["viewport"],
): CovasDocument {
	return {
		...document,
		viewport: { ...viewport, zoom: clampZoom(viewport.zoom) },
	};
}
