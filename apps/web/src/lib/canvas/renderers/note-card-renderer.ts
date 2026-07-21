import { Container, Graphics, Text } from "pixi.js";
import { getCanvasResolution } from "$lib/canvas/canvas-rendering";
import type { CanvasNoteItem } from "$lib/canvas/canvas-schema";
import { resolveCanvasColor } from "$lib/canvas/core/palette";
import { positionShell } from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

const RADIUS = 8;
const PADDING = 12;

type NoteParts = {
	root: Container;
	background: Graphics;
	body: Text;
	sig: string;
};

const partsByContainer = new WeakMap<Container, NoteParts>();

function sync(
	container: Container,
	item: CanvasNoteItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = resolveCanvasColor(item.color, context.colorMode);

	// Skip the redraw when nothing relevant changed.
	const sig = [
		width,
		height,
		selected,
		hovered,
		item.text,
		item.color,
		context.colorMode,
	].join("|");
	if (sig === parts.sig) return;
	parts.sig = sig;

	parts.background.clear();
	// Translucent tinted fill over a soft surface, with a saturated top accent.
	parts.background
		.roundRect(0, 0, width, height, RADIUS)
		.fill({ color: color.fill, alpha: 0.16 })
		.roundRect(0, 0, width, height, RADIUS)
		.fill({ color: context.palette.surface, alpha: 0.6 })
		.rect(1, 1, width - 2, 4)
		.fill({ color: color.stroke, alpha: 0.95 });
	parts.background.roundRect(0, 0, width, height, RADIUS).stroke({
		color: selected
			? color.stroke
			: hovered
				? context.palette.muted
				: context.palette.border,
		width: selected ? 2 : 1,
		alpha: selected ? 0.95 : 0.8,
	});

	if (parts.body.text !== item.text) parts.body.text = item.text;
	parts.body.style.fill = color.label;
	parts.body.style.wordWrapWidth = Math.max(1, width - PADDING * 2);
	parts.body.x = PADDING;
	parts.body.y = PADDING + 4;
}

export const noteCardRenderer: CanvasCardRenderer = {
	id: "note-card",
	canRender: (item) => item.type === "note",
	create: (item, context) => {
		const root = new Container();
		const background = new Graphics();
		const body = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontFamily: "Geist",
				fontSize: 14,
				fontWeight: "500",
				wordWrap: true,
				lineHeight: 20,
			},
			resolution: getCanvasResolution(),
			roundPixels: true,
		});
		root.addChild(background, body);
		partsByContainer.set(root, { root, background, body, sig: "" });
		if (item.type === "note") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "note") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
