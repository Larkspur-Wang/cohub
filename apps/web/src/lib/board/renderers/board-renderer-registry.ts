import type { Container, Texture } from "pixi.js";
import type { BoardDocument, BoardItem } from "$lib/board/board-schema";
import type { BoardShapeColors } from "$lib/board/core/palette";
import { arrowCardRenderer } from "$lib/board/renderers/arrow-card-renderer";
import { drawCardRenderer } from "$lib/board/renderers/draw-card-renderer";
import { frameCardRenderer } from "$lib/board/renderers/frame-card-renderer";
import { geoCardRenderer } from "$lib/board/renderers/geo-card-renderer";
import { imageCardRenderer } from "$lib/board/renderers/image-card-renderer";
import { noteCardRenderer } from "$lib/board/renderers/note-card-renderer";
import { textCardRenderer } from "$lib/board/renderers/text-card-renderer";
import { unknownCardRenderer } from "$lib/board/renderers/unknown-card-renderer";
import { videoCardRenderer } from "$lib/board/renderers/video-card-renderer";

export type BoardRenderPalette = {
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

export type BoardRenderContext = {
	document: BoardDocument;
	selectedIds: Set<string>;
	hoveredId: string | null;
	palette: BoardRenderPalette;
	/**
	 * Live shape colors resolved from CSS tokens (theme + space theme.css).
	 * Prefer this over hard-coded light/dark tables at render time.
	 */
	colors: BoardShapeColors;
	/** Resolved color mode, for fallback mapping when colors are unavailable. */
	colorMode: "dark" | "light";
	/** Current camera zoom — used for text re-rasterisation buckets. */
	zoom: number;
	/** Stable image cache key for an item, or null if it is not an image. */
	imageKey: (item: BoardItem) => string | null;
	/** Currently loaded texture for a key (null while loading). */
	getTexture: (key: string) => Texture | null;
	/** Whether the image for a key failed to load (for a failure placeholder). */
	hasError: (key: string) => boolean;
	/** Reference-counted texture acquisition / release keyed by image key. */
	acquireTexture: (key: string) => void;
	releaseTexture: (key: string) => void;
};

export type BoardCardRenderer = {
	id: string;
	canRender: (item: BoardItem, context: BoardRenderContext) => boolean;
	create: (item: BoardItem, context: BoardRenderContext) => Container;
	/** Efficiently sync an existing container to a (possibly changed) item. */
	update: (
		container: Container,
		item: BoardItem,
		context: BoardRenderContext,
	) => void;
	destroy?: (container: Container, context: BoardRenderContext) => void;
};

const boardCardRenderers: BoardCardRenderer[] = [
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

export function getBoardCardRenderer(
	item: BoardItem,
	context: BoardRenderContext,
) {
	return (
		boardCardRenderers.find((renderer) => renderer.canRender(item, context)) ??
		unknownCardRenderer
	);
}

export function registerBoardCardRenderer(renderer: BoardCardRenderer) {
	const existingIndex = boardCardRenderers.findIndex(
		(candidate) => candidate.id === renderer.id,
	);
	if (existingIndex >= 0) boardCardRenderers.splice(existingIndex, 1, renderer);
	else boardCardRenderers.unshift(renderer);
}
