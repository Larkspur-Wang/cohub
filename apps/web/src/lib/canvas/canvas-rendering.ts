const MAX_CANVAS_RESOLUTION = 2;

export function getCanvasResolution() {
	return Math.min(globalThis.devicePixelRatio || 1, MAX_CANVAS_RESOLUTION);
}

/**
 * Zoom buckets for text re-rasterisation. Pixi Text is a bitmap: at high zoom it
 * looks soft unless we raise its resolution. We quantise zoom into a few
 * buckets so small zoom changes don't thrash texture regeneration.
 */
const TEXT_ZOOM_BUCKETS = [0.5, 1, 1.5, 2, 3, 4] as const;

export function textZoomBucket(zoom: number): number {
	const clamped = Math.max(0.1, Math.min(4, zoom));
	for (const bucket of TEXT_ZOOM_BUCKETS) {
		if (clamped <= bucket) return bucket;
	}
	return TEXT_ZOOM_BUCKETS[TEXT_ZOOM_BUCKETS.length - 1] ?? 4;
}

/** Effective text resolution for a given camera zoom. */
export function textResolutionForZoom(zoom: number): number {
	const bucket = textZoomBucket(zoom);
	return Math.min(
		getCanvasResolution() * Math.max(1, bucket),
		MAX_CANVAS_RESOLUTION * 3,
	);
}
