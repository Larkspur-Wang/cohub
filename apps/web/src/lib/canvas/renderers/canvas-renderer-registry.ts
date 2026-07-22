import type { Container, Texture } from "pixi.js";
import type { CanvasItem, CovasDocument } from "$lib/canvas/canvas-schema";
import type { CanvasShapeColors } from "$lib/canvas/core/palette";
import { arrowCardRenderer } from "$lib/canvas/renderers/arrow-card-renderer";
import { drawCardRenderer } from "$lib/canvas/renderers/draw-card-renderer";
import { frameCardRenderer } from "$lib/canvas/renderers/frame-card-renderer";
import { geoCardRenderer } from "$lib/canvas/renderers/geo-card-renderer";
import { imageCardRenderer } from "$lib/canvas/renderers/image-card-renderer";
import { noteCardRenderer } from "$lib/canvas/renderers/note-card-renderer";
import { textCardRenderer } from "$lib/canvas/renderers/text-card-renderer";
import { unknownCardRenderer } from "$lib/canvas/renderers/unknown-card-renderer";
import { videoCardRenderer } from "$lib/canvas/renderers/video-card-renderer";

export type CanvasRenderPalette = {
	bg: number;
	surface: number;
	hover: number;
	border: number;
	brand: number;
	text: number;
	muted: number;
	rare: number;
	epic: number;
	legendary: number;
};

export type CanvasRenderContext = {
	document: CovasDocument;
	selectedIds: Set<string>;
	hoveredId: string | null;
	palette: CanvasRenderPalette;
	/**
	 * Live shape colors resolved from CSS tokens (theme + space theme.css).
	 * Prefer this over hard-coded light/dark tables at render time.
	 */
	colors: CanvasShapeColors;
	/** Resolved color mode, for fallback mapping when colors are unavailable. */
	colorMode: "dark" | "light";
	/** Current camera zoom — used for text re-rasterisation buckets. */
	zoom: number;
	/** Stable image cache key for an item, or null if it is not an image. */
	imageKey: (item: CanvasItem) => string | null;
	/** Currently loaded texture for a key (null while loading). */
	getTexture: (key: string) => Texture | null;
	/** Whether the image for a key failed to load (for a failure placeholder). */
	hasError: (key: string) => boolean;
	/** Reference-counted texture acquisition / release keyed by image key. */
	acquireTexture: (key: string) => void;
	releaseTexture: (key: string) => void;
};

export type CanvasCardRenderer = {
	id: string;
	canRender: (item: CanvasItem, context: CanvasRenderContext) => boolean;
	create: (item: CanvasItem, context: CanvasRenderContext) => Container;
	/** Efficiently sync an existing container to a (possibly changed) item. */
	update: (
		container: Container,
		item: CanvasItem,
		context: CanvasRenderContext,
	) => void;
	destroy?: (container: Container, context: CanvasRenderContext) => void;
};

const canvasCardRenderers: CanvasCardRenderer[] = [
	textCardRenderer,
	noteCardRenderer,
	imageCardRenderer,
	videoCardRenderer,
	geoCardRenderer,
	drawCardRenderer,
	arrowCardRenderer,
	frameCardRenderer,
	unknownCardRenderer,
];

export function getCanvasCardRenderer(
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	return (
		canvasCardRenderers.find((renderer) => renderer.canRender(item, context)) ??
		unknownCardRenderer
	);
}

export function registerCanvasCardRenderer(renderer: CanvasCardRenderer) {
	const existingIndex = canvasCardRenderers.findIndex(
		(candidate) => candidate.id === renderer.id,
	);
	if (existingIndex >= 0)
		canvasCardRenderers.splice(existingIndex, 1, renderer);
	else canvasCardRenderers.unshift(renderer);
}
