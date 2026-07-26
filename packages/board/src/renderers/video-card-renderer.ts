import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import { Container, Graphics, Text } from "pixi.js";
import {
	syncTextResolution,
	syncTextWrapWidth,
	textResolutionForZoom,
} from "../text-resolution.js";
import type { BoardItem, BoardVideoItem } from "@cohub/protocol/board-document";
import { positionShell } from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarPlate } from "./far-plate.js";

type VideoParts = {
	root: Container;
	plate: Graphics;
	badge: Graphics;
	label: Text;
	visualSig: string;
	textSig: string;
	wrapWidth: number;
	resolution: number;
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
	syncTextResolution(parts.label, parts, context.zoom);
	const resizing = context.resizingIds.has(item.id);
	const visualSig = [
		width,
		height,
		selected,
		hovered,
		context.palette.surface,
		context.palette.brand,
		context.palette.muted,
		context.palette.border,
		context.palette.hover,
		context.palette.text,
	].join("|");
	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;
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
	}

	const textSig = [title, context.palette.muted].join("|");
	if (textSig !== parts.textSig) {
		parts.textSig = textSig;
		parts.label.text = title;
		parts.label.style.fill = context.palette.muted;
	}
	syncTextWrapWidth(parts.label, parts, Math.max(1, width - 16), resizing);
	parts.label.position.set(8, height - parts.label.height - 8);
}

export const videoCardRenderer: BoardCardRenderer = {
	id: "video-card",
	canRender: (item) => item.type === "video",
	create: (item, context) => {
		const root = new Container();
		const plate = new Graphics();
		const badge = new Graphics();
		const resolution = textResolutionForZoom(context.zoom);
		const label = new Text({
			text: "",
			style: {
				fill: context.palette.muted,
				fontFamily: BOARD_FONT_STACK,
				fontSize: 12,
				fontWeight: "500",
				wordWrap: true,
			},
			resolution,
			roundPixels: true,
		});
		root.addChild(plate, badge, label);
		partsByContainer.set(root, {
			root,
			plate,
			badge,
			label,
			visualSig: "",
			textSig: "",
			wrapWidth: 0,
			resolution,
		});
		if (item.type === "video") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "video") sync(container, item, context);
	},
	// Far LOD: plate plus a brand accent band, so video reads apart from stills.
	renderFar: (graphics, item, context) => {
		drawFarPlate(graphics, item.frame, {
			fill: context.palette.surface,
			fillAlpha: 0.96,
			accent: context.palette.brand,
			accentAlpha: 0.75,
		});
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};

export function isVideoItem(item: BoardItem): item is BoardVideoItem {
	return item.type === "video";
}
