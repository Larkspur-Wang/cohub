import { Container, Graphics, Text } from "pixi.js";
import { getBoardResolution } from "$lib/board/board-rendering";
import type { BoardUnknownItem } from "$lib/board/board-schema";
import { unknownRealType } from "$lib/board/board-schema";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

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
	item: BoardUnknownItem,
	context: BoardRenderContext,
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

export const unknownCardRenderer: BoardCardRenderer = {
	id: "unknown-card",
	canRender: (item) => "raw" in item,
	create: (item, context) => {
		const root = new Container();
		const box = new Graphics();
		const label = new Text({
			text: "",
			style: { fontFamily: "Geist Mono", fontSize: 11, fontWeight: "600" },
			resolution: getBoardResolution(),
			roundPixels: true,
		});
		root.addChild(box, label);
		partsByContainer.set(root, { root, box, label, sig: "" });
		if ("raw" in item) sync(root, item as BoardUnknownItem, context);
		return root;
	},
	update: (container, item, context) => {
		if ("raw" in item) sync(container, item as BoardUnknownItem, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
