import { Container, Graphics, Text } from "pixi.js";
import { getCanvasResolution } from "$lib/canvas/canvas-rendering";
import type { CanvasUnknownItem } from "$lib/canvas/canvas-schema";
import { unknownRealType } from "$lib/canvas/canvas-schema";
import { positionShell } from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

const RADIUS = 10;

type UnknownParts = {
	root: Container;
	box: Graphics;
	label: Text;
	sig: string;
};

const partsByContainer = new WeakMap<Container, UnknownParts>();

/**
 * Neutral placeholder for shape types this client does not recognise. The shape
 * stays fully interactive (select/move/resize via the generic box definition) and
 * its data is preserved elsewhere — this is only its display.
 */
function sync(
	container: Container,
	item: CanvasUnknownItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const realType = unknownRealType(item);
	const sig = [width, height, selected, realType, context.colorMode].join("|");
	if (sig === parts.sig) return;
	parts.sig = sig;

	parts.box.clear();
	parts.box
		.roundRect(0, 0, width, height, RADIUS)
		.fill({ color: context.palette.surface, alpha: 0.7 })
		.roundRect(0, 0, width, height, RADIUS)
		.stroke({
			color: selected ? context.palette.brand : context.palette.border,
			width: selected ? 2 : 1,
			alpha: 0.8,
		});
	// Dashed hint that this content is not natively rendered.
	parts.box.roundRect(6, 6, width - 12, height - 12, RADIUS - 4).stroke({
		color: context.palette.muted,
		width: 1,
		alpha: 0.4,
	});

	const text = realType;
	if (parts.label.text !== text) parts.label.text = text;
	parts.label.style.fill = context.palette.muted;
	parts.label.x = (width - parts.label.width) / 2;
	parts.label.y = (height - parts.label.height) / 2;
}

export const unknownCardRenderer: CanvasCardRenderer = {
	id: "unknown-card",
	canRender: (item) => "raw" in item,
	create: (item, context) => {
		const root = new Container();
		const box = new Graphics();
		const label = new Text({
			text: "",
			style: { fontFamily: "Geist Mono", fontSize: 11, fontWeight: "600" },
			resolution: getCanvasResolution(),
			roundPixels: true,
		});
		root.addChild(box, label);
		partsByContainer.set(root, { root, box, label, sig: "" });
		if ("raw" in item) sync(root, item as CanvasUnknownItem, context);
		return root;
	},
	update: (container, item, context) => {
		if ("raw" in item) sync(container, item as CanvasUnknownItem, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
