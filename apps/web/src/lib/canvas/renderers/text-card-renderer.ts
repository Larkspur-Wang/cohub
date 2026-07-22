import { Container, Text } from "pixi.js";
import { textResolutionForZoom } from "$lib/canvas/canvas-rendering";
import type { CanvasItem, CanvasTextItem } from "$lib/canvas/canvas-schema";
import { pickCanvasColor } from "$lib/canvas/core/palette";
import { positionShell } from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

/** World-space typography for freestanding text. */
export const TEXT_FONT_SIZE = 18;
export const TEXT_LINE_HEIGHT = 24;
export const TEXT_FONT_FAMILY = "Geist";
export const TEXT_MIN_WIDTH = 16;
export const TEXT_MIN_HEIGHT = TEXT_LINE_HEIGHT;

type TextParts = {
	root: Container;
	body: Text;
	resolution: number;
	sig: string;
};

const partsByContainer = new WeakMap<Container, TextParts>();

/**
 * Measure plain text into world-space bounds. Used by the editor when autosize
 * text is committed so the frame tracks content instead of a card shell.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
	if (measureCtx !== undefined) return measureCtx;
	if (typeof document === "undefined") {
		measureCtx = null;
		return null;
	}
	const canvas = document.createElement("canvas");
	measureCtx = canvas.getContext("2d");
	return measureCtx;
}

/**
 * Measure plain text into world-space bounds. Prefer Canvas2D metrics so the
 * frame matches Geist rendering; fall back to a stable approximation in tests.
 */
export function measureCanvasText(
	text: string,
	maxWidth?: number | null,
): { width: number; height: number } {
	const lines = (text || " ").split("\n");
	const ctx = getMeasureContext();
	if (ctx) {
		ctx.font = `500 ${TEXT_FONT_SIZE}px ${TEXT_FONT_FAMILY}, system-ui, sans-serif`;
		if (maxWidth && maxWidth > 0) {
			const width = Math.max(TEXT_MIN_WIDTH, maxWidth);
			let rows = 0;
			for (const line of lines) {
				if (!line) {
					rows += 1;
					continue;
				}
				// Greedy wrap by measured width.
				let remaining = line;
				while (remaining.length > 0) {
					if (ctx.measureText(remaining).width <= width) {
						rows += 1;
						break;
					}
					let lo = 1;
					let hi = remaining.length;
					while (lo < hi) {
						const mid = Math.ceil((lo + hi) / 2);
						if (ctx.measureText(remaining.slice(0, mid)).width <= width)
							lo = mid;
						else hi = mid - 1;
					}
					const take = Math.max(1, lo);
					rows += 1;
					remaining = remaining.slice(take);
				}
			}
			return {
				width,
				height: Math.max(TEXT_MIN_HEIGHT, rows * TEXT_LINE_HEIGHT),
			};
		}
		let width = TEXT_MIN_WIDTH;
		for (const line of lines) {
			width = Math.max(
				width,
				Math.ceil(ctx.measureText(line || " ").width) + 2,
			);
		}
		return {
			width,
			height: Math.max(TEXT_MIN_HEIGHT, lines.length * TEXT_LINE_HEIGHT),
		};
	}
	// Test / SSR fallback.
	const charW = TEXT_FONT_SIZE * 0.52;
	let width = TEXT_MIN_WIDTH;
	if (maxWidth && maxWidth > 0) {
		width = Math.max(TEXT_MIN_WIDTH, maxWidth);
		let rows = 0;
		for (const line of lines) {
			const chars = Math.max(1, line.length);
			rows += Math.max(1, Math.ceil((chars * charW) / width));
		}
		return {
			width,
			height: Math.max(TEXT_MIN_HEIGHT, rows * TEXT_LINE_HEIGHT),
		};
	}
	for (const line of lines) {
		width = Math.max(width, Math.ceil(line.length * charW) + 2);
	}
	return {
		width,
		height: Math.max(TEXT_MIN_HEIGHT, lines.length * TEXT_LINE_HEIGHT),
	};
}

function sync(
	container: Container,
	item: CanvasTextItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);
	const color = pickCanvasColor(
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

export const textCardRenderer: CanvasCardRenderer = {
	id: "text-card",
	canRender: (item) => item.type === "text",
	create: (item, context) => {
		const root = new Container();
		const resolution = textResolutionForZoom(context.zoom);
		const color = pickCanvasColor(
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

export function isTextItem(item: CanvasItem): item is CanvasTextItem {
	return item.type === "text";
}
