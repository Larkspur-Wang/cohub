/**
 * Board rendering model.
 *
 * This package owns everything that turns a board document into pixels: the
 * document schema, world-space geometry, the shape palette and the PixiJS card
 * renderers. It is deliberately platform-neutral — the browser editor and the
 * headless CLI exporter both drive the *same* renderers, so an exported image
 * cannot drift from what the editor draws.
 */

export * from "@cohub/protocol/board-document";
export * from "./codec.js";
export * from "./core/bindings.js";
export * from "./core/draw-geometry.js";
export * from "./core/file-preview.js";
export * from "./core/palette.js";
export * from "./core/shape-definition.js";
// `ArrowEndpoint` and `DrawPoint` also exist on the document schema; the schema
// is the persisted shape, so it wins and the shape-layer aliases stay internal.
export {
	FULL_CAPABILITIES,
	GEO_KINDS,
	type ArrowShapeProps,
	type DrawShapeProps,
	type GeoKind,
	type GeoShapeProps,
	type HandleDragResult,
	type ImageShapeProps,
	type NoteShapeProps,
	type ShapeCapabilities,
	type ShapeGeometry,
	type ShapeHandle,
	type ShapeHandleId,
	type TextShapeProps,
	type VideoShapeProps,
	isGeoKind,
} from "./core/shape-types.js";
export * from "./core/text-layout.js";
export * from "./geometry.js";
export * from "./image-key.js";
export * from "./renderers/board-renderer-registry.js";
export * from "./text-resolution.js";
export * from "./themes/board-theme-registry.js";
