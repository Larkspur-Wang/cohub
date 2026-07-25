import { Container, Graphics, Text } from "pixi.js";
import {
	syncTextResolution,
	syncTextWrapWidth,
	textResolutionForZoom,
} from "$lib/board/board-rendering";
import type { BoardNoteItem } from "$lib/board/board-schema";
import { pickBoardColor } from "$lib/board/core/palette";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

const RADIUS = 8;
const PADDING = 12;

type NoteParts = {
	root: Container;
	background: Graphics;
	body: Text;
	visualSig: string;
	textSig: string;
	wrapWidth: number;
	resolution: number;
};

const partsByContainer = new WeakMap<Container, NoteParts>();

function sync(
	container: Container,
	item: BoardNoteItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const color = pickBoardColor(context.colors, item.color, context.colorMode);

	syncTextResolution(parts.body, parts, context.zoom);
	const resizing = context.resizingIds.has(item.id);

	const visualSig = [
		width,
		height,
		selected,
		hovered,
		color.fill,
		color.stroke,
		context.palette.surface,
		context.palette.muted,
		context.palette.border,
	].join("|");
	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;
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
	}

	const textSig = [item.text, color.label].join("|");
	if (textSig !== parts.textSig) {
		parts.textSig = textSig;
		parts.body.text = item.text;
		parts.body.style.fill = color.label;
	}
	syncTextWrapWidth(
		parts.body,
		parts,
		Math.max(1, width - PADDING * 2),
		resizing,
	);
	parts.body.position.set(PADDING, PADDING + 4);
}

export const noteCardRenderer: BoardCardRenderer = {
	id: "note-card",
	canRender: (item) => item.type === "note",
	create: (item, context) => {
		const root = new Container();
		const background = new Graphics();
		const resolution = textResolutionForZoom(context.zoom);
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
			resolution,
			roundPixels: true,
		});
		root.addChild(background, body);
		partsByContainer.set(root, {
			root,
			background,
			body,
			visualSig: "",
			textSig: "",
			wrapWidth: 0,
			resolution,
		});
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
