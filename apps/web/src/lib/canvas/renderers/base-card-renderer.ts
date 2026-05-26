import { Container, Graphics, Text } from "pixi.js";
import { getResourceTitle, inferMediaKind } from "$lib/canvas/canvas-media";
import type { CanvasItem } from "$lib/canvas/canvas-schema";
import type { CanvasRenderContext } from "$lib/canvas/renderers/canvas-renderer-registry";

export function titleForCanvasItem(item: CanvasItem) {
	if (item.type === "text") return item.text.split("\n")[0] || "Text note";
	return (
		item.snapshot?.title ??
		(item.ref.kind === "space-file"
			? getResourceTitle(item.ref.path)
			: getResourceTitle(item.ref.url))
	);
}

export function subtitleForCanvasItem(item: CanvasItem) {
	if (item.type === "text") return "Text";
	const value = item.ref.kind === "space-file" ? item.ref.path : item.ref.url;
	const kind = inferMediaKind(value, item.snapshot?.mimeType);
	return item.ref.kind === "space-file"
		? `${kind} · Space file`
		: `${kind} · Remote URL`;
}

export function emphasisColor(item: CanvasItem, context: CanvasRenderContext) {
	if (item.style?.accentColor) {
		const normalized = parseCssColor(item.style.accentColor);
		if (normalized != null) return normalized;
	}
	switch (item.style?.emphasis) {
		case "rare":
			return context.palette.rare;
		case "epic":
			return context.palette.epic;
		case "legendary":
			return context.palette.legendary;
		default:
			return context.palette.brand;
	}
}

function parseCssColor(value: string) {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.fillStyle = value;
	const normalized = context.fillStyle;
	const match = /^#([0-9a-f]{6})$/i.exec(normalized);
	return match ? Number.parseInt(match[1], 16) : null;
}

export function createBaseCard(
	item: CanvasItem,
	context: CanvasRenderContext,
	options: { badge: string; body: string },
) {
	const card = new Container();
	card.x = item.frame.x;
	card.y = item.frame.y;
	card.rotation = (item.frame.rotation * Math.PI) / 180;
	card.eventMode = "static";
	card.cursor = "grab";
	card.on("pointerdown", (event) => context.onItemPointerDown(item, event));

	const selected = context.selectedItemIds.includes(item.id);
	const accent = emphasisColor(item, context);
	const frame = item.frame;
	const background = new Graphics();
	background
		.roundRect(0, 0, frame.width, frame.height, 10)
		.fill({ color: context.palette.surface, alpha: 0.98 });
	background.roundRect(0, 0, frame.width, frame.height, 10).stroke({
		color: selected ? accent : context.palette.border,
		width: selected ? 2 : 1,
		alpha: selected ? 0.95 : 0.8,
	});
	background
		.rect(0, frame.height - 38, frame.width, 38)
		.fill({ color: context.palette.hover, alpha: 0.7 });
	if (
		item.style?.effects?.includes("glow") ||
		item.style?.emphasis === "legendary"
	) {
		background
			.roundRect(3, 3, frame.width - 6, frame.height - 6, 8)
			.stroke({ color: accent, width: 1, alpha: 0.35 });
	}
	card.addChild(background);

	const badge = new Text({
		text: options.badge,
		style: {
			fill: selected ? accent : context.palette.muted,
			fontFamily: "Geist Mono",
			fontSize: 10,
			fontWeight: "600",
		},
	});
	badge.x = 12;
	badge.y = 12;
	card.addChild(badge);

	const body = new Text({
		text: options.body,
		style: {
			fill: context.palette.muted,
			fontFamily: "Geist",
			fontSize: 12,
			wordWrap: true,
			wordWrapWidth: frame.width - 24,
			lineHeight: 17,
		},
	});
	body.x = 12;
	body.y = 36;
	card.addChild(body);

	const title = new Text({
		text: titleForCanvasItem(item),
		style: {
			fill: context.palette.text,
			fontFamily: "Geist",
			fontSize: 12,
			fontWeight: "500",
			wordWrap: true,
			wordWrapWidth: frame.width - 24,
		},
	});
	title.x = 12;
	title.y = frame.height - 27;
	card.addChild(title);

	return card;
}
