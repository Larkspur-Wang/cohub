import { Container, Graphics, Text } from "pixi.js";
import { getBoardResolution } from "$lib/board/board-rendering";
import type { BoardGeoItem } from "$lib/board/board-schema";
import { pickBoardColor } from "$lib/board/core/palette";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

const RADIUS = 8;
const LABEL_PADDING = 8;

type GeoParts = {
	root: Container;
	shape: Graphics;
	label: Text;
	sig: string;
};

const partsByContainer = new WeakMap<Container, GeoParts>();

function traceOutline(
	graphics: Graphics,
	geo: BoardGeoItem["geo"],
	width: number,
	height: number,
) {
	switch (geo) {
		case "ellipse":
			graphics.ellipse(width / 2, height / 2, width / 2, height / 2);
			return;
		case "diamond":
			graphics
				.moveTo(width / 2, 0)
				.lineTo(width, height / 2)
				.lineTo(width / 2, height)
				.lineTo(0, height / 2)
				.closePath();
			return;
		case "triangle":
			graphics
				.moveTo(width / 2, 0)
				.lineTo(width, height)
				.lineTo(0, height)
				.closePath();
			return;
		case "rounded":
			graphics.roundRect(0, 0, width, height, RADIUS);
			return;
		default:
			graphics.rect(0, 0, width, height);
	}
}

function sync(
	container: Container,
	item: BoardGeoItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorMode);

	const sig = [
		width,
		height,
		selected,
		hovered,
		item.geo,
		item.text,
		item.color,
		item.fillOpacity,
		context.colorMode,
		context.colors.brand.stroke,
	].join("|");
	if (sig === parts.sig) return;
	parts.sig = sig;

	parts.shape.clear();
	traceOutline(parts.shape, item.geo, width, height);
	if (item.fillOpacity > 0)
		parts.shape.fill({ color: color.fill, alpha: item.fillOpacity });
	traceOutline(parts.shape, item.geo, width, height);
	parts.shape.stroke({
		color: selected
			? color.stroke
			: hovered
				? context.palette.muted
				: color.stroke,
		width: selected ? 2.5 : 1.75,
		alpha: selected ? 1 : hovered ? 0.95 : 0.85,
	});

	if (parts.label.text !== item.text) parts.label.text = item.text;
	parts.label.visible = item.text.length > 0;
	parts.label.style.fill = color.label;
	parts.label.style.wordWrapWidth = Math.max(1, width - LABEL_PADDING * 2);
	// Center the label inside the shape.
	parts.label.x = (width - parts.label.width) / 2;
	parts.label.y = (height - parts.label.height) / 2;
}

export const geoCardRenderer: BoardCardRenderer = {
	id: "geo-card",
	canRender: (item) => item.type === "geo",
	create: (item, context) => {
		const root = new Container();
		const shape = new Graphics();
		const label = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontFamily: "Geist",
				fontSize: 14,
				fontWeight: "500",
				align: "center",
				wordWrap: true,
				lineHeight: 20,
			},
			resolution: getBoardResolution(),
			roundPixels: true,
		});
		root.addChild(shape, label);
		partsByContainer.set(root, { root, shape, label, sig: "" });
		if (item.type === "geo") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "geo") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
