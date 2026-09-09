/**
 * Pure geometry helpers for the overlay layer. Kept free of runtime imports so
 * tests exercise the production math without dragging in the SDK.
 */
import type { AppRuntimeConfigureRequest } from "@cohub/protocol/app-runtime";

export type OverlayGeometry = NonNullable<AppRuntimeConfigureRequest["geometry"]>;
export type OverlayInputRegion = NonNullable<
	AppRuntimeConfigureRequest["inputRegion"]
>;

type Viewport = { width: number; height: number };

type Axis = { size: number; offset: number };

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(value, max));

/**
 * Resolves one axis: a missing size fills that axis; a given size is clamped
 * to the viewport and the offset is kept inside `[0, viewport - size]` so no
 * part of the overlay can end up off-screen. `anchorEnd` measures the offset
 * from the far edge, `anchorCenter` from the middle.
 */
function resolveAxis(
	size: number | undefined,
	offset: number,
	extent: number,
	anchor: "start" | "end" | "center",
): Axis {
	if (size == null) return { size: extent, offset: 0 };
	const clampedSize = clamp(size, 1, extent);
	const room = extent - clampedSize;
	const start =
		anchor === "start"
			? offset
			: anchor === "end"
				? room - offset
				: room / 2 + offset;
	return { size: clampedSize, offset: clamp(start, 0, room) };
}

/**
 * Inline style for one overlay. Each axis is resolved independently: an axis
 * without a size fills the layer, an axis with a size is clamped so the
 * overlay always stays fully on-screen regardless of anchor.
 */
export function resolveOverlayStyle(
	geometry: OverlayGeometry,
	viewport: Viewport,
): string {
	const anchor = geometry.anchor ?? "top-left";
	const horizontal =
		anchor === "center" ? "center" : anchor.endsWith("right") ? "end" : "start";
	const vertical =
		anchor === "center" ? "center" : anchor.startsWith("bottom") ? "end" : "start";
	const x = resolveAxis(geometry.width, geometry.x ?? 0, viewport.width, horizontal);
	const y = resolveAxis(geometry.height, geometry.y ?? 0, viewport.height, vertical);
	return `left: ${x.offset}px; top: ${y.offset}px; width: ${x.size}px; height: ${y.size}px`;
}

/**
 * `clip-path` restricting both painting and hit-testing to the declared input
 * region. Returns an empty style for `all` (no clip) and hides the surface from
 * pointer events entirely for `none` (the layer's default).
 */
export function resolveOverlayInputClip(region: OverlayInputRegion): string {
	if (region === "all") return "";
	if (region === "none") return "pointer-events: none";
	if (region.length === 0) return "pointer-events: none";
	const polygons = region.map(
		(rect) =>
			`polygon(${rect.x}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x}px ${rect.y + rect.height}px)`,
	);
	// Multiple rects: clip-path takes a single shape, so union them via a
	// path. One rect stays a plain polygon for the common case.
	if (polygons.length === 1) return `clip-path: ${polygons[0]}`;
	const path = region
		.map(
			(rect) =>
				`M${rect.x} ${rect.y}h${rect.width}v${rect.height}h${-rect.width}z`,
		)
		.join(" ");
	return `clip-path: path('${path}')`;
}
