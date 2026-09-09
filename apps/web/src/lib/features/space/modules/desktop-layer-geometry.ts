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

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

/**
 * Inline style for one overlay. Geometry is clamped to the viewport so an App
 * can never park itself off-screen; an overlay without a size fills the layer.
 */
export function resolveOverlayStyle(
	geometry: OverlayGeometry,
	viewport: Viewport,
): string {
	const anchor = geometry.anchor ?? "top-left";
	const x = clamp(geometry.x ?? 0, viewport.width);
	const y = clamp(geometry.y ?? 0, viewport.height);
	const parts: string[] = [];

	if (geometry.width != null && geometry.height != null) {
		parts.push(
			`width: ${Math.max(1, Math.min(geometry.width, viewport.width))}px`,
			`height: ${Math.max(1, Math.min(geometry.height, viewport.height))}px`,
		);
	} else {
		parts.push("inset: 0");
		return parts.join("; ");
	}

	switch (anchor) {
		case "top-left":
			parts.push(`left: ${x}px`, `top: ${y}px`);
			break;
		case "top-right":
			parts.push(`right: ${x}px`, `top: ${y}px`);
			break;
		case "bottom-left":
			parts.push(`left: ${x}px`, `bottom: ${y}px`);
			break;
		case "bottom-right":
			parts.push(`right: ${x}px`, `bottom: ${y}px`);
			break;
		case "center":
			parts.push(
				`left: calc(50% + ${geometry.x ?? 0}px)`,
				`top: calc(50% + ${geometry.y ?? 0}px)`,
				"transform: translate(-50%, -50%)",
			);
			break;
	}
	return parts.join("; ");
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
