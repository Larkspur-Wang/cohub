import type { CanvasFrame, CanvasViewport } from "$lib/canvas/canvas-schema";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

// Branded point types. The brand is phantom (no runtime cost) but makes
// screen and world coordinates incompatible at compile time, so a screen
// point can never be fed into world-space hit testing (or vice versa).
declare const coordBrand: unique symbol;
/** Surface-relative screen coordinate, in CSS pixels. */
export type ScreenPoint = {
	x: number;
	y: number;
	readonly [coordBrand]: "screen";
};
/** Canvas world coordinate, in canvas units. */
export type WorldPoint = {
	x: number;
	y: number;
	readonly [coordBrand]: "world";
};

export function screenPoint(x: number, y: number): ScreenPoint {
	return { x, y } as ScreenPoint;
}

export function worldPoint(x: number, y: number): WorldPoint {
	return { x, y } as WorldPoint;
}

export const MIN_CANVAS_ZOOM = 0.05;
export const MAX_CANVAS_ZOOM = 8;
/** Smallest an item can be resized to, in world units. */
export const MIN_ITEM_SIZE = 24;
/** Extra world-space padding applied when fitting content into view. */
export const FIT_PADDING = 64;
/**
 * Fraction of the viewport's larger dimension used as an off-screen margin for
 * both card culling and texture preloading. Keeping them equal means a card's
 * texture is already requested before the card scrolls into view.
 */
export const VIEWPORT_MARGIN_RATIO = 0.5;

export function clampZoom(zoom: number) {
	return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function degToRad(degrees: number) {
	return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number) {
	return (radians * 180) / Math.PI;
}

// ─── Basic rect / point helpers ─────────────────────────────────────

export function frameRect(frame: CanvasFrame): Rect {
	return {
		x: frame.x,
		y: frame.y,
		width: frame.width,
		height: frame.height,
	};
}

export function rectCenter(rect: Rect): WorldPoint {
	return worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

export function rectContainsPoint(
	rect: Rect,
	point: Point,
	tolerance = 0,
): boolean {
	return (
		point.x >= rect.x - tolerance &&
		point.x <= rect.x + rect.width + tolerance &&
		point.y >= rect.y - tolerance &&
		point.y <= rect.y + rect.height + tolerance
	);
}

export function expandRect(rect: Rect, amount: number): Rect {
	return {
		x: rect.x - amount,
		y: rect.y - amount,
		width: rect.width + amount * 2,
		height: rect.height + amount * 2,
	};
}

export function unionRects(rects: Rect[]): Rect | null {
	if (rects.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const rect of rects) {
		minX = Math.min(minX, rect.x);
		minY = Math.min(minY, rect.y);
		maxX = Math.max(maxX, rect.x + rect.width);
		maxY = Math.max(maxY, rect.y + rect.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rotatePointAround<P extends Point>(
	point: P,
	center: Point,
	angleRad: number,
): P {
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const dx = point.x - center.x;
	const dy = point.y - center.y;
	return {
		x: center.x + dx * cos - dy * sin,
		y: center.y + dx * sin + dy * cos,
	} as P;
}

// ─── Item bounds (rotation aware) ───────────────────────────────────

/** Axis-aligned bounding box of a (possibly rotated) frame. */
export function itemBounds(frame: CanvasFrame): Rect {
	const rotation = frame.rotation || 0;
	if (rotation === 0) return frameRect(frame);
	const center = rectCenter(frameRect(frame));
	const halfW = frame.width / 2;
	const halfH = frame.height / 2;
	const rad = degToRad(rotation);
	const cos = Math.abs(Math.cos(rad));
	const sin = Math.abs(Math.sin(rad));
	const boundW = halfW * cos + halfH * sin;
	const boundH = halfW * sin + halfH * cos;
	return {
		x: center.x - boundW,
		y: center.y - boundH,
		width: boundW * 2,
		height: boundH * 2,
	};
}

export function selectionBounds(frames: CanvasFrame[]): Rect | null {
	return unionRects(frames.map(itemBounds));
}

/** Exact point-in-frame test, accounting for rotation. */
export function frameContainsPoint(
	frame: CanvasFrame,
	point: WorldPoint,
): boolean {
	const rect = frameRect(frame);
	const rotation = frame.rotation || 0;
	let local = point;
	if (rotation !== 0) {
		local = rotatePointAround(point, rectCenter(rect), -degToRad(rotation));
	}
	return rectContainsPoint(rect, local);
}

/** World position of a resize handle on a single (possibly rotated) frame. */
export function frameHandlePosition(
	frame: CanvasFrame,
	handle: ResizeHandle,
): WorldPoint {
	const rect = frameRect(frame);
	const position = handlePosition(rect, handle);
	const rotation = frame.rotation || 0;
	if (rotation === 0) return position;
	return rotatePointAround(position, rectCenter(rect), degToRad(rotation));
}

// ─── Selection handles ──────────────────────────────────────────────

/** Screen-space radius (px) within which a pointer grabs a handle. */
export const HANDLE_HIT_RADIUS = 8;
/** Screen-space offset (px) of the rotation handle above the selection. */
export const ROTATION_HANDLE_OFFSET = 28;

export function rotationHandlePosition(bounds: Rect, zoom: number): WorldPoint {
	return worldPoint(
		bounds.x + bounds.width / 2,
		bounds.y - ROTATION_HANDLE_OFFSET / Math.max(zoom, 0.0001),
	);
}

// ─── Resize ─────────────────────────────────────────────────────────

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const RESIZE_HANDLES: ResizeHandle[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];

/** Direction of a handle from the rect center: -1, 0, or 1 per axis. */
export const HANDLE_DIRECTION: Record<ResizeHandle, Point> = {
	nw: { x: -1, y: -1 },
	n: { x: 0, y: -1 },
	ne: { x: 1, y: -1 },
	e: { x: 1, y: 0 },
	se: { x: 1, y: 1 },
	s: { x: 0, y: 1 },
	sw: { x: -1, y: 1 },
	w: { x: -1, y: 0 },
};

/** Position of a handle on an unrotated rect. */
export function handlePosition(rect: Rect, handle: ResizeHandle): WorldPoint {
	const direction = HANDLE_DIRECTION[handle];
	return worldPoint(
		rect.x + rect.width / 2 + (direction.x * rect.width) / 2,
		rect.y + rect.height / 2 + (direction.y * rect.height) / 2,
	);
}

/**
 * Resize a frame by dragging a handle to a world-space pointer position.
 * The edge/corner opposite the handle stays anchored. Works correctly for
 * rotated frames by performing the resize in the frame's local space.
 */
export function resizeFrame(
	frame: CanvasFrame,
	handle: ResizeHandle,
	pointer: WorldPoint,
	minSize = MIN_ITEM_SIZE,
	/** Keep the original aspect ratio (Shift). */
	keepAspect = false,
): CanvasFrame {
	const direction = HANDLE_DIRECTION[handle];
	const rect = frameRect(frame);
	const center = rectCenter(rect);
	const rad = degToRad(frame.rotation || 0);
	const aspect = rect.width / Math.max(rect.height, 0.0001);

	// Anchor = opposite edge/corner, held fixed during the resize.
	const anchorLocal = {
		x: (-direction.x * rect.width) / 2,
		y: (-direction.y * rect.height) / 2,
	};
	const anchor = rotatePointAround(
		{ x: center.x + anchorLocal.x, y: center.y + anchorLocal.y },
		center,
		rad,
	);

	// Express the pointer in the frame's unrotated local space, origin at anchor.
	const toLocal = rotatePointAround(pointer, anchor, -rad);
	const local = { x: toLocal.x - anchor.x, y: toLocal.y - anchor.y };

	let width =
		direction.x !== 0
			? clamp(direction.x * local.x, minSize, Number.POSITIVE_INFINITY)
			: rect.width;
	let height =
		direction.y !== 0
			? clamp(direction.y * local.y, minSize, Number.POSITIVE_INFINITY)
			: rect.height;

	if (keepAspect) {
		if (direction.x !== 0 && direction.y !== 0) {
			// Corner: pick the dominant axis and derive the other.
			if (Math.abs(width / aspect) > height) height = width / aspect;
			else width = height * aspect;
		} else if (direction.x !== 0) {
			height = width / aspect;
		} else if (direction.y !== 0) {
			width = height * aspect;
		}
		width = Math.max(minSize, width);
		height = Math.max(minSize, height);
	}

	// New center in local space, then back to world space.
	const centerLocal = {
		x: (direction.x * width) / 2,
		y: (direction.y * height) / 2,
	};
	const rotatedCenter = rotatePointAround(
		{ x: anchor.x + centerLocal.x, y: anchor.y + centerLocal.y },
		anchor,
		rad,
	);

	return {
		x: rotatedCenter.x - width / 2,
		y: rotatedCenter.y - height / 2,
		width,
		height,
		rotation: frame.rotation || 0,
	};
}

/**
 * Proportionally scale a group of frames by dragging a corner handle of their
 * combined bounds. Individual rotations are preserved.
 */
export function scaleFrames(
	frames: CanvasFrame[],
	bounds: Rect,
	handle: ResizeHandle,
	pointer: WorldPoint,
	minSize = MIN_ITEM_SIZE,
): CanvasFrame[] {
	const direction = HANDLE_DIRECTION[handle];
	if (direction.x === 0 || direction.y === 0) return frames;
	const anchor = {
		x: bounds.x + bounds.width / 2 - (direction.x * bounds.width) / 2,
		y: bounds.y + bounds.height / 2 - (direction.y * bounds.height) / 2,
	};
	const original = handlePosition(bounds, handle);
	const originalDist = Math.hypot(original.x - anchor.x, original.y - anchor.y);
	const nextDist = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
	if (originalDist === 0) return frames;
	const scale = clamp(
		nextDist / originalDist,
		minSize / Math.max(bounds.width, bounds.height),
		Number.POSITIVE_INFINITY,
	);
	return frames.map((frame) => {
		const center = rectCenter(frameRect(frame));
		const nextCenter = {
			x: anchor.x + (center.x - anchor.x) * scale,
			y: anchor.y + (center.y - anchor.y) * scale,
		};
		const width = Math.max(minSize, frame.width * scale);
		const height = Math.max(minSize, frame.height * scale);
		return {
			x: nextCenter.x - width / 2,
			y: nextCenter.y - height / 2,
			width,
			height,
			rotation: frame.rotation || 0,
		};
	});
}

// ─── Rotation ───────────────────────────────────────────────────────

/** Angle (degrees) from a center to a world-space pointer. */
export function angleFromCenter(
	center: WorldPoint,
	pointer: WorldPoint,
): number {
	return radToDeg(Math.atan2(pointer.y - center.y, pointer.x - center.x));
}

/**
 * Rotate a set of frames around a pivot by a delta (degrees). Each frame's
 * center orbits the pivot and its own rotation increases by the delta.
 */
export function rotateFrames(
	frames: CanvasFrame[],
	pivot: WorldPoint,
	deltaDeg: number,
): CanvasFrame[] {
	const rad = degToRad(deltaDeg);
	return frames.map((frame) => {
		const center = rectCenter(frameRect(frame));
		const nextCenter = rotatePointAround(center, pivot, rad);
		return {
			x: nextCenter.x - frame.width / 2,
			y: nextCenter.y - frame.height / 2,
			width: frame.width,
			height: frame.height,
			rotation: (frame.rotation || 0) + deltaDeg,
		};
	});
}

/** Normalize a rotation into the [-180, 180] range for tidy persistence. */
export function normalizeRotation(degrees: number): number {
	let value = degrees % 360;
	if (value > 180) value -= 360;
	if (value < -180) value += 360;
	return Math.abs(value) < 0.01 ? 0 : value;
}

// ─── Camera ─────────────────────────────────────────────────────────

/** Convert a surface-relative screen point into world space. */
export function pointToWorld(
	point: ScreenPoint,
	viewport: CanvasViewport,
): WorldPoint {
	return worldPoint(
		(point.x - viewport.x) / viewport.zoom,
		(point.y - viewport.y) / viewport.zoom,
	);
}

export function worldToScreen(
	point: WorldPoint,
	viewport: CanvasViewport,
): ScreenPoint {
	return screenPoint(
		point.x * viewport.zoom + viewport.x,
		point.y * viewport.zoom + viewport.y,
	);
}

export function screenToWorld(
	clientX: number,
	clientY: number,
	rect: DOMRect,
	viewport: CanvasViewport,
): WorldPoint {
	return pointToWorld(
		screenPoint(clientX - rect.left, clientY - rect.top),
		viewport,
	);
}

/** Zoom while keeping a surface-relative screen point fixed under the cursor. */
export function zoomAround(
	viewport: CanvasViewport,
	anchor: ScreenPoint,
	nextZoom: number,
): CanvasViewport {
	const zoom = clampZoom(nextZoom);
	const world = pointToWorld(anchor, viewport);
	return {
		x: anchor.x - world.x * zoom,
		y: anchor.y - world.y * zoom,
		zoom,
	};
}

export function panBy(
	viewport: CanvasViewport,
	dx: number,
	dy: number,
): CanvasViewport {
	return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

/** Compute a viewport that frames the given world rect within the surface. */
export function fitToContent(
	content: Rect,
	surface: Size,
	padding = FIT_PADDING,
): CanvasViewport {
	const availableW = Math.max(1, surface.width - padding * 2);
	const availableH = Math.max(1, surface.height - padding * 2);
	const zoom = clampZoom(
		Math.min(availableW / content.width, availableH / content.height),
	);
	return {
		x: surface.width / 2 - (content.x + content.width / 2) * zoom,
		y: surface.height / 2 - (content.y + content.height / 2) * zoom,
		zoom,
	};
}

/** World-space rectangle currently visible in the canvas stage. */
export function visibleWorldRect(
	viewport: CanvasViewport,
	surfaceWidth: number,
	surfaceHeight: number,
): Rect {
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
