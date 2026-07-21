import type { Container, Texture } from "pixi.js";
import type { CanvasItem, CovasDocument } from "$lib/canvas/canvas-schema";
import { resourceCardRenderer } from "$lib/canvas/renderers/resource-card-renderer";
import { textCardRenderer } from "$lib/canvas/renderers/text-card-renderer";

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
	resourceCardRenderer,
];

export function getCanvasCardRenderer(
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	return (
		canvasCardRenderers.find((renderer) => renderer.canRender(item, context)) ??
		resourceCardRenderer
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
