import { Container, Text } from "pixi.js";
import { textResolutionForZoom } from "$lib/board/board-rendering";
import type { BoardItem, BoardTextItem } from "$lib/board/board-schema";
import { pickBoardColor } from "$lib/board/core/palette";
import {
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT,
	TEXT_MIN_WIDTH,
} from "$lib/board/core/text-layout";
import { positionShell } from "$lib/board/renderers/base-card-renderer";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "$lib/board/renderers/board-renderer-registry";

type TextParts = {
	root: Container;
	body: Text;
	resolution: number;
	sig: string;
};

const partsByContainer = new WeakMap<Container, TextParts>();

function sync(
	container: Container,
	item: BoardTextItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const color = pickBoardColor(
		context.colors,
		item.color || "neutral",
		context.colorMode,
	);
	// On open paper, stroke reads as ink; label is for filled chips/notes.
	const ink =
		item.color === "neutral" || !item.color
			? context.palette.text
			: color.stroke;
	const nextRes = textResolutionForZoom(context.zoom);
	if (nextRes !== parts.resolution) {
		parts.body.resolution = nextRes;
		parts.resolution = nextRes;
	}
	const wrapWidth = item.autoSize
		? 0
		: Math.max(TEXT_MIN_WIDTH, item.frame.width);
	const sig = [
		item.text,
		item.color,
		item.autoSize,
		item.frame.width,
		item.frame.height,
		context.colorMode,
		context.colors.brand.stroke,
		context.palette.text,
		nextRes,
	].join("|");
	if (sig === parts.sig) return;
	parts.sig = sig;

	if (parts.body.text !== item.text) parts.body.text = item.text || "";
	parts.body.style.fill = ink;
	parts.body.style.wordWrap = !item.autoSize;
	parts.body.style.wordWrapWidth = wrapWidth || 10000;
	parts.body.x = 0;
	parts.body.y = 0;
}

export const textCardRenderer: BoardCardRenderer = {
	id: "text-card",
	canRender: (item) => item.type === "text",
	create: (item, context) => {
		const root = new Container();
		const resolution = textResolutionForZoom(context.zoom);
		const color = pickBoardColor(
			context.colors,
			item.type === "text" ? item.color || "neutral" : "neutral",
			context.colorMode,
		);
		const ink =
			item.type === "text" && (item.color === "neutral" || !item.color)
				? context.palette.text
				: color.stroke;
		const body = new Text({
			text: "",
			style: {
				fill: ink,
				fontFamily: TEXT_FONT_FAMILY,
				fontSize: TEXT_FONT_SIZE,
				fontWeight: "500",
				lineHeight: TEXT_LINE_HEIGHT,
				wordWrap: false,
				breakWords: true,
			},
			resolution,
			roundPixels: true,
		});
		root.addChild(body);
		partsByContainer.set(root, { root, body, resolution, sig: "" });
		if (item.type === "text") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "text") sync(container, item, context);
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};

export function isTextItem(item: BoardItem): item is BoardTextItem {
	return item.type === "text";
}
