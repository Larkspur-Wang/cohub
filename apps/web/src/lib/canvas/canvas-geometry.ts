import type { CanvasViewport } from "$lib/canvas/canvas-schema";

export const MIN_CANVAS_ZOOM = 0.25;
export const MAX_CANVAS_ZOOM = 3;

export function clampZoom(zoom: number) {
	return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function screenToWorld(
	clientX: number,
	clientY: number,
	rect: DOMRect,
	viewport: CanvasViewport,
) {
	return {
		x: (clientX - rect.left - viewport.x) / viewport.zoom,
		y: (clientY - rect.top - viewport.y) / viewport.zoom,
	};
}

/** World-space rectangle currently visible in the canvas stage. */
export function visibleWorldRect(
	viewport: CanvasViewport,
	surfaceWidth: number,
	surfaceHeight: number,
) {
	const width = Math.max(0, surfaceWidth);
	const height = Math.max(0, surfaceHeight);
	const zoom = viewport.zoom || 1;
	return {
		x: -viewport.x / zoom,
		y: -viewport.y / zoom,
		width: width / zoom,
		height: height / zoom,
	};
}
