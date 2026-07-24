import { Container, Graphics, Text } from "pixi.js";
import { getBoardResolution } from "$lib/board/board-rendering";
import type { BoardItem, BoardVideoItem } from "$lib/board/board-schema";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

type VideoParts = {
	root: Container;
	plate: Graphics;
	badge: Graphics;
	label: Text;
	sig: string;
};

const partsByContainer = new WeakMap<Container, VideoParts>();
const RADIUS = 4;

function sync(
	container: Container,
	item: BoardVideoItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const title =
		item.snapshot?.title ?? item.ref.path.split("/").pop() ?? "Video";
	const sig = [width, height, selected, hovered, title, context.colorMode].join(
		"|",
	);
	if (sig === parts.sig) return;
	parts.sig = sig;

	parts.plate.clear();
	parts.plate
		.roundRect(0, 0, width, height, RADIUS)
		.fill({ color: context.palette.surface, alpha: 0.96 })
		.roundRect(0, 0, width, height, RADIUS)
		.stroke({
			color: selected
				? context.palette.brand
				: hovered
					? context.palette.muted
					: context.palette.border,
			width: selected ? 2 : 1,
			alpha: selected ? 0.95 : 0.85,
		});

	// Play badge centered.
	const cx = width / 2;
	const cy = height / 2;
	const r = Math.min(22, Math.min(width, height) * 0.18);
	parts.badge.clear();
	parts.badge.circle(cx, cy, r).fill({
		color: selected ? context.palette.brand : context.palette.hover,
		alpha: 0.92,
	});
	// Triangle.
	const s = r * 0.55;
	parts.badge
		.moveTo(cx - s * 0.35, cy - s * 0.6)
		.lineTo(cx - s * 0.35, cy + s * 0.6)
		.lineTo(cx + s * 0.7, cy)
		.closePath()
		.fill({ color: context.palette.text, alpha: 0.92 });

	if (parts.label.text !== title) parts.label.text = title;
	parts.label.style.fill = context.palette.muted;
	parts.label.style.wordWrapWidth = Math.max(1, width - 16);
	parts.label.x = 8;
	parts.label.y = height - parts.label.height - 8;
}

export const videoCardRenderer: BoardCardRenderer = {
	id: "video-card",
	canRender: (item) => item.type === "video",
	create: (item, context) => {
		const root = new Container();
		const plate = new Graphics();
		const badge = new Graphics();
		const label = new Text({
			text: "",
			style: {
				fill: context.palette.muted,
				fontFamily: "Geist",
				fontSize: 12,
				fontWeight: "500",
				wordWrap: true,
			},
			resolution: getBoardResolution(),
			roundPixels: true,
		});
		root.addChild(plate, badge, label);
		partsByContainer.set(root, { root, plate, badge, label, sig: "" });
		if (item.type === "video") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "video") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};

export function isVideoItem(item: BoardItem): item is BoardVideoItem {
	return item.type === "video";
}
