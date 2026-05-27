const MAX_CANVAS_RESOLUTION = 2;

export function getCanvasResolution() {
	return Math.min(globalThis.devicePixelRatio || 1, MAX_CANVAS_RESOLUTION);
}
