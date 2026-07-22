import { Container, Graphics, type Text } from "pixi.js";
import type { CanvasItem } from "$lib/canvas/canvas-schema";
import { pickCanvasColor } from "$lib/canvas/core/palette";
import { createLabel } from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

type FrameParts = {
	root: Container;
	box: Graphics;
	label: Text;
};

const partsByContainer = new WeakMap<Container, FrameParts>();

function sync(
	container: Container,
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts || item.type !== "frame") return;

	const { frame, label, color, locked } = item;
	parts.root.position.set(frame.x, frame.y);
	parts.root.rotation = 0;

	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const palette = pickCanvasColor(context.colors, color, context.colorMode);
	const stroke = selected ? context.palette.brand : palette.stroke;
	const alpha = selected ? 1 : hovered ? 0.85 : 0.55;

	parts.box.clear();
	// Subtle fill so the container reads as a region.
	parts.box
		.roundRect(0, 0, frame.width, frame.height, 4)
		.fill({ color: palette.fill, alpha: 0.04 });
	parts.box.roundRect(0, 0, frame.width, frame.height, 4).stroke({
		color: stroke,
		width: selected ? 2 : 1.5,
		alpha,
		// Dashed look approximated by thinner stroke when unselected.
	});

	const title = locked ? `🔒 ${label || "Frame"}` : label || "Frame";
	if (parts.label.text !== title) parts.label.text = title;
	parts.label.style.fill = palette.stroke;
	parts.label.x = 4;
	parts.label.y = -18;
}

export const frameCardRenderer: CanvasCardRenderer = {
	id: "frame-card",
	canRender: (item) => item.type === "frame",
	create: (item, context) => {
		const root = new Container();
		const box = new Graphics();
		const label = createLabel("", {
			fill: context.palette.muted,
			fontFamily: "Geist",
			fontSize: 12,
			fontWeight: "600",
		});
		root.addChild(box, label);
		partsByContainer.set(root, { root, box, label });
		sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.delete(container);
		container.destroy({ children: true });
	},
};
