import type { Application, Container } from "pixi.js";
import type { CanvasViewport, CovasDocument } from "$lib/canvas/canvas-schema";
import type { CanvasRenderPalette } from "$lib/canvas/renderers/canvas-renderer-registry";
import { cleanCanvasTheme } from "$lib/canvas/themes/clean-theme";

export type CanvasThemeContext = {
	app: Application;
	document: CovasDocument;
	viewport: CanvasViewport;
	palette: CanvasRenderPalette;
};

export type CanvasThemeRenderer = {
	id: string;
	canRender: (document: CovasDocument) => boolean;
	createBackground: (context: CanvasThemeContext) => Container;
	updateBackground?: (
		container: Container,
		context: CanvasThemeContext,
	) => void;
};

const canvasThemeRenderers: CanvasThemeRenderer[] = [cleanCanvasTheme];

export function getCanvasThemeRenderer(document: CovasDocument) {
	return (
		canvasThemeRenderers.find((renderer) => renderer.canRender(document)) ??
		cleanCanvasTheme
	);
}

export function registerCanvasThemeRenderer(renderer: CanvasThemeRenderer) {
	const existingIndex = canvasThemeRenderers.findIndex(
		(candidate) => candidate.id === renderer.id,
	);
	if (existingIndex >= 0)
		canvasThemeRenderers.splice(existingIndex, 1, renderer);
	else canvasThemeRenderers.unshift(renderer);
}
