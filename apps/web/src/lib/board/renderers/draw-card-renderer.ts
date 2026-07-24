import { Container, Graphics } from "pixi.js";
import type { BoardDrawItem } from "$lib/board/board-schema";
import { buildStrokeOutline } from "$lib/board/core/draw-geometry";
import { pickBoardColor } from "$lib/board/core/palette";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

type DrawParts = {
	root: Container;
	stroke: Graphics;
	sig: string;
	/** Last points array rendered; a new array (edit/undo) forces a redraw. */
	points: unknown;
};

const partsByContainer = new WeakMap<Container, DrawParts>();

function sync(
	container: Container,
	item: BoardDrawItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorMode);

	// Rebuild the ribbon only when the stroke or its styling changes. Position is
	// handled by positionShell, so a pure drag does not re-tessellate the path.
	// The points array identity is part of the key so an edit/undo that replaces
	// the samples (even at unchanged length) re-renders.
	const sig = [
		item.points.length,
		item.size,
		item.color,
		selected,
		hovered,
		context.colorMode,
		context.colors.brand.stroke,
	].join("|");
	if (sig === parts.sig && item.points === parts.points) return;
	parts.sig = sig;
	parts.points = item.points;

	parts.stroke.clear();
	const outline = buildStrokeOutline(item.points, item.size);
	if (outline.length >= 3) {
		parts.stroke.moveTo(outline[0].x, outline[0].y);
		for (let i = 1; i < outline.length; i += 1)
			parts.stroke.lineTo(outline[i].x, outline[i].y);
		parts.stroke.closePath();
		parts.stroke.fill({
			color: color.stroke,
			alpha: selected || hovered ? 1 : 0.92,
		});
	}
}

export const drawCardRenderer: BoardCardRenderer = {
	id: "draw-card",
	canRender: (item) => item.type === "draw",
	create: (item, context) => {
		const root = new Container();
		const stroke = new Graphics();
		root.addChild(stroke);
		partsByContainer.set(root, { root, stroke, sig: "", points: null });
		if (item.type === "draw") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "draw") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
