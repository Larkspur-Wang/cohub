import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { inferMediaKind } from "$lib/canvas/canvas-media";
import type { CanvasItem } from "$lib/canvas/canvas-schema";
import {
	type CardShell,
	createCardShell,
	createLabel,
	emphasisColor,
	positionShell,
} from "$lib/canvas/renderers/base-card-renderer";
import type {
	CanvasCardRenderer,
	CanvasRenderContext,
} from "$lib/canvas/renderers/canvas-renderer-registry";

const KIND_LABEL: Record<string, string> = {
	image: "IMG",
	video: "VID",
	text: "TXT",
	file: "FILE",
};

type ResourceCardParts = {
	shell: CardShell;
	image: Sprite | null;
	imageKey: string | null;
	placeholder: Graphics;
	placeholderSig: string;
	badge: Container;
	body: ReturnType<typeof createLabel>;
	lastKind: string;
};

const partsByContainer = new WeakMap<Container, ResourceCardParts>();

function resourceValue(item: CanvasItem): string {
	if (item.type !== "resource") return "";
	return item.ref.kind === "space-file" ? item.ref.path : item.ref.url;
}

function createBadge(kind: string, context: CanvasRenderContext): Container {
	const badge = new Container();
	const background = new Graphics();
	const label = createLabel(KIND_LABEL[kind] ?? "FILE", {
		fill: context.palette.muted,
		fontFamily: "Geist Mono",
		fontSize: 9,
		fontWeight: "600",
	});
	badge.addChild(background, label);
	const width = label.width + 12;
	const height = 16;
	background
		.roundRect(0, 0, width, height, 4)
		.fill({ color: context.palette.bg, alpha: 0.75 });
	label.x = 6;
	label.y = (height - label.height) / 2;
	return badge;
}

function layoutCover(
	sprite: Sprite,
	area: { x: number; y: number; width: number; height: number },
) {
	const texture = sprite.texture;
	const tw = texture.width;
	const th = texture.height;
	if (!tw || !th) return;
	const scale = Math.max(area.width / tw, area.height / th);
	sprite.width = tw * scale;
	sprite.height = th * scale;
	sprite.x = area.x + (area.width - sprite.width) / 2;
	sprite.y = area.y + (area.height - sprite.height) / 2;
}

function syncContent(
	parts: ResourceCardParts,
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	const kind = inferMediaKind(
		resourceValue(item),
		item.type === "resource" ? item.snapshot?.mimeType : undefined,
	);
	const key = kind === "image" ? context.imageKey(item) : null;
	const area = parts.shell.contentRect();

	// Rebuild the badge when the kind changes.
	if (parts.lastKind !== kind) {
		parts.badge.destroy({ children: true });
		parts.badge = createBadge(kind, context);
		parts.shell.content.addChild(parts.badge);
		parts.lastKind = kind;
	}
	parts.badge.x = area.x + 6;
	parts.badge.y = area.y + 6;

	// Track the image by cache key, acquiring/releasing reference counts so the
	// asset manager can free textures no card displays.
	if (key) {
		if (key !== parts.imageKey) {
			if (parts.imageKey) context.releaseTexture(parts.imageKey);
			context.acquireTexture(key);
			parts.imageKey = key;
		}
		if (!parts.image) {
			parts.image = new Sprite(Texture.EMPTY);
			parts.shell.content.addChildAt(parts.image, 0);
		}
	} else if (parts.image) {
		if (parts.imageKey) context.releaseTexture(parts.imageKey);
		parts.imageKey = null;
		parts.image.destroy();
		parts.image = null;
	}

	// Apply the loaded texture; it may arrive on a later sync (the stage bumps
	// a version when the asset manager finishes loading).
	const texture = key ? context.getTexture(key) : null;
	if (parts.image) {
		if (texture && parts.image.texture !== texture)
			parts.image.texture = texture;
		parts.image.visible = texture !== null;
		if (texture) layoutCover(parts.image, area);
	}

	// Failure placeholder when the image could not be loaded.
	const failed = Boolean(key && !texture && context.hasError(key));
	const sig = failed ? `${area.width}x${area.height}` : "";
	if (failed && sig !== parts.placeholderSig) {
		parts.placeholder.clear();
		parts.placeholder
			.roundRect(area.x, area.y, area.width, area.height, 4)
			.fill({ color: context.palette.hover, alpha: 0.5 })
			.roundRect(area.x, area.y, area.width, area.height, 4)
			.stroke({ color: context.palette.border, width: 1, alpha: 0.8 });
	}
	parts.placeholderSig = sig;
	parts.placeholder.visible = failed;

	// Body text only for non-image resources.
	const bodyText = kind === "image" ? "" : resourceValue(item);
	if (parts.body.text !== bodyText) parts.body.text = bodyText;
	// Keep wrap width in sync with the card width (resize, not just text edits).
	const wrapWidth = Math.max(1, area.width - 8);
	if (parts.body.style.wordWrapWidth !== wrapWidth)
		parts.body.style.wordWrapWidth = wrapWidth;
	parts.body.style.fill = context.palette.muted;
	parts.body.visible = bodyText !== "";
	parts.body.x = area.x + 2;
	parts.body.y = area.y + 26;
}

function sync(
	container: Container,
	item: CanvasItem,
	context: CanvasRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.shell.root, item);
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	parts.shell.update(
		{
			width: item.frame.width,
			height: item.frame.height,
			selected,
			hovered,
			accent: emphasisColor(item, context.palette),
			title:
				item.type === "resource"
					? (item.snapshot?.title ?? resourceValue(item).split("/").pop() ?? "")
					: "",
		},
		context.palette,
		true,
	);
	syncContent(parts, item, context);
}

export const resourceCardRenderer: CanvasCardRenderer = {
	id: "resource-card",
	canRender: (item) => item.type === "resource",
	create: (item, context) => {
		const shell = createCardShell();
		const body = createLabel("", {
			fill: context.palette.muted,
			fontFamily: "Geist Mono",
			fontSize: 10,
			wordWrap: true,
			lineHeight: 15,
		});
		const parts: ResourceCardParts = {
			shell,
			image: null,
			imageKey: null,
			placeholder: new Graphics(),
			placeholderSig: "",
			badge: new Container(),
			body,
			lastKind: "",
		};
		shell.content.addChild(body);
		shell.content.addChild(parts.placeholder);
		partsByContainer.set(shell.root, parts);
		sync(shell.root, item, context);
		return shell.root;
	},
	update: (container, item, context) => {
		sync(container, item, context);
	},
	destroy: (container, context) => {
		const parts = partsByContainer.get(container);
		if (parts?.imageKey) context.releaseTexture(parts.imageKey);
		parts?.shell.destroy();
		partsByContainer.delete(container);
	},
};
