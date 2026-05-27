import { Container, Graphics } from "pixi.js";
import type { CanvasThemeRenderer } from "$lib/canvas/themes/canvas-theme-registry";

export const cleanCanvasTheme: CanvasThemeRenderer = {
	id: "clean",
	canRender: () => true,
	createBackground: (context) => {
		const container = new Container();
		drawCleanBackground(container, context);
		return container;
	},
	updateBackground: (container, context) => {
		drawCleanBackground(container, context);
	},
};

function drawCleanBackground(
	container: Container,
	context: Parameters<CanvasThemeRenderer["createBackground"]>[0],
) {
	container.removeChildren();
	const { app, document, palette, viewport } = context;
	const graphics = new Graphics();
	const width = app.screen.width;
	const height = app.screen.height;
	graphics.rect(0, 0, width, height).fill({ color: palette.bg, alpha: 1 });

	const appearance = document.appearance;
	if (appearance.grid?.visible !== false) {
		const size = Math.max(4, appearance.grid?.size ?? 32);
		const opacity = appearance.grid?.opacity ?? 0.22;
		const step = Math.max(4, size * viewport.zoom);
		const offsetX = viewport.x % step;
		const offsetY = viewport.y % step;
		for (let x = offsetX; x < width; x += step) {
			graphics.moveTo(x, 0).lineTo(x, height);
		}
		for (let y = offsetY; y < height; y += step) {
			graphics.moveTo(0, y).lineTo(width, y);
		}
		graphics.stroke({ color: palette.border, alpha: opacity, width: 1 });
	}
	container.addChild(graphics);
}
