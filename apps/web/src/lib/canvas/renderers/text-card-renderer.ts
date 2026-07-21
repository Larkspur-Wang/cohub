import type { Container } from "pixi.js";
import { textResolutionForZoom } from "$lib/canvas/canvas-rendering";
import type { CanvasItem } from "$lib/canvas/canvas-schema";
import {
	type CardShell,
	createCardShell,
	createLabel,
	emphasisColor,
	positionShell,
} from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

type TextCardParts = {
	shell: CardShell;
	body: ReturnType<typeof createLabel>;
	/** Last zoom-bucket resolution applied to the body text. */
	resolution: number;
};

const partsByContainer = new WeakMap<Container, TextCardParts>();

function sync(
	container: Container,
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts || item.type !== "text") return;
	positionShell(parts.shell.root, item);
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	parts.shell.update(
		{
			width: item.frame.width,
			height: item.frame.height,
			selected,
			hovered,
			accent: emphasisColor(item, context.palette),
			title: "",
		},
		context.palette,
		false,
	);
	const area = parts.shell.contentRect();
	if (parts.body.text !== item.text) parts.body.text = item.text;
	const wrapWidth = Math.max(1, area.width - 4);
	if (parts.body.style.wordWrapWidth !== wrapWidth)
		parts.body.style.wordWrapWidth = wrapWidth;
	parts.body.style.fill = context.palette.text;
	parts.body.x = area.x + 2;
	parts.body.y = area.y + 2;

	// Re-rasterise when the camera crosses a zoom bucket so text stays crisp.
	const nextRes = textResolutionForZoom(context.zoom);
	if (nextRes !== parts.resolution) {
		parts.body.resolution = nextRes;
		parts.resolution = nextRes;
	}
}

export const textCardRenderer: CanvasCardRenderer = {
	id: "text-card",
	canRender: (item) => item.type === "text",
	create: (item, context) => {
		const shell = createCardShell();
		const resolution = textResolutionForZoom(context.zoom);
		const body = createLabel("", {
			fill: context.palette.text,
			fontFamily: "Geist",
			fontSize: 13,
			wordWrap: true,
			lineHeight: 19,
		});
		body.resolution = resolution;
		shell.content.addChild(body);
		partsByContainer.set(shell.root, { shell, body, resolution });
		sync(shell.root, item, context);
		return shell.root;
	},
	update: (container, item, context) => {
		sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.shell.destroy();
		partsByContainer.delete(container);
	},
};
