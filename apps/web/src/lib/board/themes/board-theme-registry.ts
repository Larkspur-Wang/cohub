import type { Application, Container } from "pixi.js";
import type { BoardDocument, BoardViewport } from "$lib/board/board-schema";
import type { BoardRenderPalette } from "$lib/board/renderers/board-renderer-registry";
import { cleanBoardTheme } from "$lib/board/themes/clean-theme";

export type BoardThemeContext = {
	app: Application;
	document: BoardDocument;
	viewport: BoardViewport;
	palette: BoardRenderPalette;
};

export type BoardThemeRenderer = {
	id: string;
	canRender: (document: BoardDocument) => boolean;
	createBackground: (context: BoardThemeContext) => Container;
	updateBackground?: (container: Container, context: BoardThemeContext) => void;
};

const boardThemeRenderers: BoardThemeRenderer[] = [cleanBoardTheme];

export function getBoardThemeRenderer(document: BoardDocument) {
	return (
		boardThemeRenderers.find((renderer) => renderer.canRender(document)) ??
		cleanBoardTheme
	);
}

export function registerBoardThemeRenderer(renderer: BoardThemeRenderer) {
	const existingIndex = boardThemeRenderers.findIndex(
		(candidate) => candidate.id === renderer.id,
	);
	if (existingIndex >= 0)
		boardThemeRenderers.splice(existingIndex, 1, renderer);
	else boardThemeRenderers.unshift(renderer);
}
