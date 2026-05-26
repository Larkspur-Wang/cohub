import type { Container } from "pixi.js";
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

export type CanvasItemPointerEvent = {
	stopPropagation: () => void;
	pointerId: number;
	global: { x: number; y: number };
	originalEvent?: MouseEvent | PointerEvent | TouchEvent;
};

export type CanvasRenderContext = {
	document: CovasDocument;
	selectedItemIds: string[];
	palette: CanvasRenderPalette;
	onItemPointerDown: (item: CanvasItem, event: CanvasItemPointerEvent) => void;
};

export type CanvasCardRenderer = {
	id: string;
	canRender: (item: CanvasItem, context: CanvasRenderContext) => boolean;
	create: (item: CanvasItem, context: CanvasRenderContext) => Container;
	update?: (
		display: Container,
		item: CanvasItem,
		context: CanvasRenderContext,
	) => void;
	destroy?: (display: Container) => void;
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
