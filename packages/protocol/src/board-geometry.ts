/**
 * Renderer-independent Board geometry contracts.
 *
 * These helpers intentionally depend only on persisted Board data. Renderers may
 * build richer geometry on top, but validation and item factories must agree on
 * the same bounds without importing a graphics library.
 */

import type { BoardFrame, DrawPoint } from "./board-document.js";

/** Radius of a draw sample in world units given stroke size and pressure. */
export function boardDrawSampleRadius(size: number, pressure: number): number {
	const clamped = Math.min(1, Math.max(0, pressure));
	return Math.max(0.5, (size / 2) * (0.5 + clamped));
}

/**
 * Exact local bounds required by the draw node contract.
 *
 * Draw points are frame-local. The frame therefore starts at the stroke bounds
 * origin and includes the pressure-aware radius of every sample.
 */
export function boardDrawBounds(
	points: readonly DrawPoint[],
	size: number,
): Pick<BoardFrame, "x" | "y" | "width" | "height"> {
	if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of points) {
		const radius = boardDrawSampleRadius(size, point.p);
		minX = Math.min(minX, point.x - radius);
		minY = Math.min(minY, point.y - radius);
		maxX = Math.max(maxX, point.x + radius);
		maxY = Math.max(maxY, point.y + radius);
	}
	return {
		x: minX,
		y: minY,
		width: Math.max(1, maxX - minX),
		height: Math.max(1, maxY - minY),
	};
}
