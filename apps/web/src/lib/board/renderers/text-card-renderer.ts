import { Container, Text } from "pixi.js";
import {
	syncTextResolution,
	textResolutionForZoom,
} from "$lib/board/board-rendering";
import type { BoardItem, BoardTextItem } from "$lib/board/board-schema";
import { pickBoardColor } from "$lib/board/core/palette";
import {
	boardTextLineHeight,
	clampBoardTextFontSize,
	measureBoardText,
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
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
	contentSig: string;
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

	const fontSize = clampBoardTextFontSize(item.fontSize);
	const measured = measureBoardText(item.text, fontSize);
	// During a resize the frame changes continuously while fontSize stays stable.
	// Scale the existing texture for the live preview, then rasterise once at the
	// final font size on pointer-up. Text is anchored at its visual center because
	// the frame geometry uses center-based rotation.
	const previewScale = Math.max(
		0.0001,
		item.frame.width / Math.max(0.0001, measured.width),
	);
	parts.body.scale.set(previewScale);
	parts.body.position.set(item.frame.width / 2, item.frame.height / 2);

	syncTextResolution(
		parts.body,
		parts,
		context.zoom * Math.max(1, previewScale),
	);

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
	const contentSig = [
		item.text,
		item.color,
		fontSize,
		context.colorMode,
		context.colors.brand.stroke,
		context.palette.text,
	].join("|");
	if (contentSig === parts.contentSig) return;
	parts.contentSig = contentSig;

	if (parts.body.text !== item.text) parts.body.text = item.text || "";
	parts.body.style.fill = ink;
	parts.body.style.fontSize = fontSize;
	parts.body.style.lineHeight = boardTextLineHeight(fontSize);
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
				lineHeight: boardTextLineHeight(TEXT_FONT_SIZE),
				wordWrap: false,
			},
			resolution,
			roundPixels: true,
		});
		body.anchor.set(0.5);
		root.addChild(body);
		partsByContainer.set(root, {
			root,
			body,
			resolution,
			contentSig: "",
		});
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
