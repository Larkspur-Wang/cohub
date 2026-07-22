/**
 * Concrete shape definitions + registration.
 *
 * Importing this module for its side effect registers every native shape with
 * the shape-definition registry. Box shapes (text, note, image, video, geo) share
 * frame-based geometry; geo refines hit testing per outline; draw and arrow
 * define their own geometry, handles and capabilities.
 */

import {
	degToRad,
	frameContainsPoint,
	rectCenter,
	rotatePointAround,
	type WorldPoint,
	worldPoint,
} from "$lib/canvas/canvas-geometry";
import type {
	CanvasArrowItem,
	CanvasDrawItem,
	CanvasGeoItem,
} from "$lib/canvas/canvas-schema";
import {
	arrowBounds,
	distanceToArrow,
	type FrameLookup,
	resolveArrow,
} from "$lib/canvas/core/bindings";
import {
	computeDrawBounds,
	distanceToStroke,
} from "$lib/canvas/core/draw-geometry";
import {
	registerShapeDefinition,
	type ShapeDefinition,
} from "$lib/canvas/core/shape-definition";
import { FULL_CAPABILITIES } from "$lib/canvas/core/shape-types";

/** Transform a world point into a draw item's local (unrotated) space. */
function drawLocalPoint(item: CanvasDrawItem, point: WorldPoint): WorldPoint {
	const center = rectCenter(item.frame);
	const rotated = item.frame.rotation
		? rotatePointAround(point, center, -degToRad(item.frame.rotation))
		: point;
	return worldPoint(rotated.x - item.frame.x, rotated.y - item.frame.y);
}

const textDefinition: ShapeDefinition = {
	type: "text",
	capabilities: { ...FULL_CAPABILITIES, canEdit: true },
};

const noteDefinition: ShapeDefinition = {
	type: "note",
	capabilities: { ...FULL_CAPABILITIES, canEdit: true },
};

const imageDefinition: ShapeDefinition = {
	type: "image",
	capabilities: { ...FULL_CAPABILITIES, canEdit: false, canRotate: true },
};

const videoDefinition: ShapeDefinition = {
	type: "video",
	capabilities: { ...FULL_CAPABILITIES, canEdit: true, canRotate: false },
};

/** Precise containment for a geo shape in its local (unrotated) space. */
function geoContainsLocal(item: CanvasGeoItem, local: WorldPoint): boolean {
	const w = item.frame.width;
	const h = item.frame.height;
	const nx = (local.x / w) * 2 - 1; // -1..1
	const ny = (local.y / h) * 2 - 1;
	switch (item.geo) {
		case "ellipse":
			return nx * nx + ny * ny <= 1;
		case "diamond":
			return Math.abs(nx) + Math.abs(ny) <= 1;
		case "triangle": {
			// Apex at top-center, base along the bottom.
			return ny >= -1 && ny <= 1 && Math.abs(nx) <= (ny + 1) / 2;
		}
		default:
			return local.x >= 0 && local.x <= w && local.y >= 0 && local.y <= h;
	}
}

const geoDefinition: ShapeDefinition = {
	type: "geo",
	capabilities: { ...FULL_CAPABILITIES, canEdit: true },
	hitTest: (item, point) => {
		if (item.type !== "geo") return false;
		if (!frameContainsPoint(item.frame, point)) return false;
		const center = rectCenter(item.frame);
		const rotated = item.frame.rotation
			? rotatePointAround(point, center, -degToRad(item.frame.rotation))
			: point;
		return geoContainsLocal(
			item,
			worldPoint(rotated.x - item.frame.x, rotated.y - item.frame.y),
		);
	},
};

const drawDefinition: ShapeDefinition = {
	type: "draw",
	capabilities: {
		...FULL_CAPABILITIES,
		canResize: false,
		canEdit: false,
		canBind: false,
	},
	getBounds: (item) =>
		item.type === "draw"
			? translateRect(
					computeDrawBounds(item.points, item.size),
					item.frame.x,
					item.frame.y,
				)
			: { x: 0, y: 0, width: 1, height: 1 },
	hitTest: (item, point) => {
		if (item.type !== "draw") return false;
		const local = drawLocalPoint(item, point);
		const threshold = Math.max(6, item.size);
		return distanceToStroke(item.points, local) <= threshold;
	},
};

function translateRect(
	rect: { x: number; y: number; width: number; height: number },
	dx: number,
	dy: number,
) {
	return {
		x: rect.x + dx,
		y: rect.y + dy,
		width: rect.width,
		height: rect.height,
	};
}

/**
 * Arrow definition. Bounds and hit testing resolve endpoints against the live
 * item set, so the editor passes a frame lookup via the context-bound helpers
 * below (arrowHitTest / arrowBoundsFor). The definition's own hitTest falls back
 * to a coarse frame test when no lookup is available.
 */
const arrowDefinition: ShapeDefinition = {
	type: "arrow",
	capabilities: {
		...FULL_CAPABILITIES,
		canResize: false,
		canRotate: false,
		canEdit: false,
		canBind: false,
		canSnap: false,
	},
	// Coarse frame fallback; the editor uses the precise arrowHitTest (curve
	// distance) for arrows. Endpoint handles are resolved in world space by the
	// editor (via resolveArrow), not as local box handles.
	hitTest: (item, point) =>
		item.type === "arrow" ? frameContainsPoint(item.frame, point) : false,
	getHandles: () => [
		{ id: "start", x: 0, y: 0 },
		{ id: "end", x: 1, y: 1 },
	],
};

const frameDefinition: ShapeDefinition = {
	type: "frame",
	capabilities: {
		...FULL_CAPABILITIES,
		canEdit: true,
		canRotate: false,
		canBind: false,
	},
};

/** Precise arrow hit test given a frame lookup (used by the editor). */
export function arrowHitTest(
	item: CanvasArrowItem,
	getFrame: FrameLookup,
	point: WorldPoint,
): boolean {
	const threshold = Math.max(8, item.size * 2);
	return distanceToArrow(item, getFrame, point) <= threshold;
}

/** Arrow bounds given a frame lookup (used by the editor for culling). */
export function arrowBoundsFor(item: CanvasArrowItem, getFrame: FrameLookup) {
	return arrowBounds(item, getFrame);
}

/** Resolved arrow geometry for rendering/overlay (null if a binding is gone). */
export function resolveArrowFor(item: CanvasArrowItem, getFrame: FrameLookup) {
	return resolveArrow(item, getFrame);
}

let registered = false;

/** Register all native shape definitions. Idempotent. */
export function registerBuiltinShapes() {
	if (registered) return;
	registered = true;
	for (const definition of [
		textDefinition,
		noteDefinition,
		imageDefinition,
		videoDefinition,
		geoDefinition,
		drawDefinition,
		arrowDefinition,
		frameDefinition,
	])
		registerShapeDefinition(definition);
}

// Register on import so any consumer of shape behaviour gets the full set.
registerBuiltinShapes();
