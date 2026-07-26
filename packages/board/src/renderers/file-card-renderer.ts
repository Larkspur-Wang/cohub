import { BOARD_FONT_STACK, BOARD_MONO_FONT_STACK } from "@cohub/protocol/board-constants";
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { syncTextResolution } from "../text-resolution.js";
import type { BoardFileItem, BoardItem } from "@cohub/protocol/board-document";
import {
	fileBaseName,
	filePreviewKind,
	fileTypeLabel,
	formatFileSize,
} from "../core/file-preview.js";
import { positionShell } from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarPlate } from "./far-plate.js";

/**
 * File card renderer.
 *
 * The card is an *entry point* to a workspace file, so it shows only what helps
 * you recognise and pick it: an optional cover, the name, a couple of lines of
 * excerpt, and the type. Everything else belongs to the file preview that opens
 * when the card is activated.
 *
 * Cost is managed through three levels of detail keyed on zoom, because a board
 * is expected to hold thousands of these. Pixi `Text` is a rasterised texture,
 * so below roughly one CSS pixel per glyph it can only ever resolve to a smudge;
 * the tiers below simply stop paying for what cannot be read anyway.
 */

const RADIUS = 4;
const PADDING = 10;
const COVER_RATIO = 0.56;
const TITLE_SIZE = 13;
const EXCERPT_SIZE = 11;
const META_SIZE = 9;

/** Zoom below which the title is dropped (glyphs are sub-pixel). */
const LOD_TITLE_ZOOM = 0.35;
/** Zoom below which the excerpt and meta line are dropped. */
const LOD_BODY_ZOOM = 0.6;

/** Availability of the referenced file, as reported by the render context. */
type FileState = "ok" | "missing" | "unavailable";

/** Upper bound on dashes in the unavailable-state edge, regardless of width. */
const MAX_DASHES = 40;

type FileParts = {
	root: Container;
	plate: Graphics;
	cover: Sprite;
	coverMask: Graphics;
	title: Text;
	excerpt: Text;
	meta: Text;
	visualSig: string;
	textSig: string;
	/** Per-text resolution state: each Text owns its own rasterisation bucket. */
	titleRes: { resolution: number };
	excerptRes: { resolution: number };
	metaRes: { resolution: number };
};

const partsByContainer = new WeakMap<Container, FileParts>();

/** Detail tier for a zoom level. */
function detailFor(zoom: number): "plate" | "title" | "full" {
	if (zoom < LOD_TITLE_ZOOM) return "plate";
	if (zoom < LOD_BODY_ZOOM) return "title";
	return "full";
}

/** Cover band height for a card, or 0 when it has no cover. */
function coverHeight(item: BoardFileItem, height: number): number {
	return filePreviewKind(item.snapshot) === "cover"
		? Math.round(height * COVER_RATIO)
		: 0;
}

function metaLine(item: BoardFileItem, state: FileState): string {
	const type = fileTypeLabel(item.ref.path);
	// State replaces the size: "how big" is moot when the file cannot be read, and
	// the wording distinguishes a definite 404 from a read that merely failed.
	if (state === "missing") return `${type} · missing`;
	if (state === "unavailable") return `${type} · unavailable`;
	const size = formatFileSize(item.snapshot?.size);
	return size ? `${type} · ${size}` : type;
}

/** Fill the cover band, cropping overflow (the band's aspect rarely matches). */
function layoutCover(
	sprite: Sprite,
	width: number,
	height: number,
	texture: Texture,
) {
	const tw = texture.width;
	const th = texture.height;
	if (!tw || !th || !height) return;
	const scale = Math.max(width / tw, height / th);
	sprite.width = tw * scale;
	sprite.height = th * scale;
	// Bias upward: the top of an image is usually the informative part.
	sprite.x = (width - sprite.width) / 2;
	sprite.y = 0;
}

function sync(
	container: Container,
	item: BoardFileItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);

	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const detail = detailFor(context.zoom);
	const key = context.imageKey(item);
	const texture = key ? context.getTexture(key) : null;
	const coverFailed = Boolean(key && !texture && context.hasError(key));
	const fileState = context.fileState(item.ref.path);
	const band = coverHeight(item, height);

	syncTextResolution(parts.title, parts.titleRes, context.zoom);
	syncTextResolution(parts.excerpt, parts.excerptRes, context.zoom);
	syncTextResolution(parts.meta, parts.metaRes, context.zoom);

	// The cache key is part of the signature so a pooled container adopted by a
	// different file always re-renders, even at an identical frame size.
	const visualSig = [
		key ?? "",
		width,
		height,
		selected,
		hovered,
		detail,
		texture ? `${texture.width}x${texture.height}` : "none",
		coverFailed,
		fileState,
		context.colorMode,
		context.palette.surface,
	].join("|");

	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;

		parts.plate.clear();
		parts.plate
			.roundRect(0, 0, width, height, RADIUS)
			.fill({ color: context.palette.surface, alpha: 0.98 })
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

		// A file that cannot be read keeps its cached facts (so the card is still
		// recognisable) and is marked with a dashed edge rather than being blanked:
		// the reference is still meaningful, and the file may well come back.
		if (fileState !== "ok") {
			// Dash length adapts to the card so a very wide plate does not emit
			// hundreds of segments for a hairline.
			const dash = Math.max(6, width / MAX_DASHES / 2);
			for (let x = 0; x < width; x += dash * 2) {
				parts.plate.moveTo(x, 0.5).lineTo(Math.min(x + dash, width), 0.5);
			}
			parts.plate.stroke({
				color: context.palette.muted,
				width: 2,
				alpha: fileState === "missing" ? 0.9 : 0.5,
			});
		}

		const showCover = band > 0 && Boolean(texture);
		if (showCover && texture) {
			layoutCover(parts.cover, width, band, texture);
			if (parts.cover.texture !== texture) parts.cover.texture = texture;
			parts.coverMask
				.clear()
				.roundRect(0, 0, width, band, RADIUS)
				.fill({ color: 0xffffff });
			// Square off the mask's lower corners so the band meets the body flush.
			parts.coverMask
				.rect(0, band - RADIUS, width, RADIUS)
				.fill({ color: 0xffffff });
		}
		parts.cover.visible = showCover;
		parts.coverMask.visible = showCover;

		if (band > 0 && !texture) {
			// Cover declared but not (yet) available: a quiet band, no error chrome.
			// A failed remote cover is not worth shouting about on a thumbnail.
			parts.plate.rect(1, 1, width - 2, band - 1).fill({
				color: context.palette.hover,
				alpha: coverFailed ? 0.35 : 0.6,
			});
		}

		// Type stripe on the left edge of the body — a quiet, always-present hint
		// that survives even when the text tiers are dropped.
		if (!band) {
			parts.plate
				.rect(1, 1, 2, height - 2)
				.fill({ color: context.palette.muted, alpha: 0.35 });
		}

		parts.title.visible = detail !== "plate";
		parts.excerpt.visible = detail === "full";
		parts.meta.visible = detail === "full";
	}

	if (detail === "plate") return;

	const title = item.snapshot?.title || fileBaseName(item.ref.path);
	const excerpt = item.snapshot?.excerpt ?? "";
	const meta = metaLine(item, fileState);
	const innerWidth = Math.max(1, width - PADDING * 2);
	const textSig = [
		title,
		excerpt,
		meta,
		detail,
		innerWidth,
		band,
		height,
		context.palette.text,
	].join("|");
	if (textSig === parts.textSig) return;
	parts.textSig = textSig;

	const top = band > 0 ? band + PADDING * 0.8 : PADDING;

	if (parts.title.text !== title) parts.title.text = title;
	parts.title.style.fill = context.palette.text;
	parts.title.style.wordWrapWidth = innerWidth;
	parts.title.position.set(PADDING, top);

	if (detail === "full") {
		if (parts.meta.text !== meta) parts.meta.text = meta;
		parts.meta.style.fill = context.palette.muted;
		parts.meta.position.set(PADDING, height - PADDING - parts.meta.height);

		const excerptTop = top + parts.title.height + 4;
		const excerptRoom = height - PADDING - parts.meta.height - 4 - excerptTop;
		const showExcerpt = Boolean(excerpt) && excerptRoom > EXCERPT_SIZE;
		if (showExcerpt) {
			if (parts.excerpt.text !== excerpt) parts.excerpt.text = excerpt;
			parts.excerpt.style.fill = context.palette.muted;
			parts.excerpt.style.wordWrapWidth = innerWidth;
			parts.excerpt.position.set(PADDING, excerptTop);
		}
		parts.excerpt.visible = showExcerpt;
	}
}

export const fileCardRenderer: BoardCardRenderer = {
	id: "file-card",
	canRender: (item) => item.type === "file",
	create: (item, context) => {
		const root = new Container();
		const plate = new Graphics();
		const cover = new Sprite(Texture.EMPTY);
		const coverMask = new Graphics();
		cover.mask = coverMask;
		const resolution = 1;

		const title = new Text({
			text: "",
			style: {
				fill: context.palette.text,
				fontFamily: BOARD_FONT_STACK,
				fontSize: TITLE_SIZE,
				fontWeight: "600",
				wordWrap: true,
				lineHeight: TITLE_SIZE * 1.35,
			},
			resolution,
			roundPixels: true,
		});
		const excerpt = new Text({
			text: "",
			style: {
				fill: context.palette.muted,
				fontFamily: BOARD_FONT_STACK,
				fontSize: EXCERPT_SIZE,
				fontWeight: "400",
				wordWrap: true,
				lineHeight: EXCERPT_SIZE * 1.45,
			},
			resolution,
			roundPixels: true,
		});
		const meta = new Text({
			text: "",
			style: {
				fill: context.palette.muted,
				fontFamily: BOARD_MONO_FONT_STACK,
				fontSize: META_SIZE,
				fontWeight: "500",
			},
			resolution,
			roundPixels: true,
		});

		root.addChild(plate, cover, coverMask, title, excerpt, meta);
		partsByContainer.set(root, {
			root,
			plate,
			cover,
			coverMask,
			title,
			excerpt,
			meta,
			visualSig: "",
			textSig: "",
			titleRes: { resolution },
			excerptRes: { resolution },
			metaRes: { resolution },
		});
		if (item.type === "file") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "file") sync(container, item, context);
	},
	/**
	 * Far LOD: a plate with a muted accent band. Sampling the real cover here
	 * would mean one draw call per distinct image and defeat the batch.
	 */
	renderFar: (graphics, item, context) => {
		drawFarPlate(graphics, item.frame, {
			fill: context.palette.surface,
			fillAlpha: 0.96,
			accent: context.palette.muted,
			accentAlpha: 0.4,
		});
	},
	destroy: (container) => {
		partsByContainer.get(container)?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};

/** Helper kept for type narrowing in tests. */
export function isFileItem(item: BoardItem): item is BoardFileItem {
	return item.type === "file";
}
