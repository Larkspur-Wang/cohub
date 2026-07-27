import { BOARD_FONT_STACK, BOARD_MONO_FONT_STACK } from "@cohub/protocol/board-constants";
import {
	CanvasTextMetrics,
	Container,
	Graphics,
	Sprite,
	Text,
	Texture,
} from "pixi.js";
import { syncTextResolution } from "../text-resolution.js";
import type { BoardFileItem, BoardItem } from "@cohub/protocol/board-document";
import {
	fileBaseName,
	filePreviewKind,
	fileTypeLabel,
	formatFileSize,
} from "../../core/file-preview.js";
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
 *
 * Absolute floor: content never paints outside the node frame. A rounded clip
 * mask is the hard boundary; line-clamped title/excerpt keep the interior tidy.
 */

const RADIUS = 4;
const PADDING = 10;
const COVER_RATIO = 0.56;
/** Minimum body height reserved under a cover so the title stays readable. */
const MIN_BODY_FOR_COVER = PADDING * 2 + 18;
const TITLE_SIZE = 13;
const TITLE_LINE = TITLE_SIZE * 1.35;
const TITLE_MAX_LINES = 2;
const EXCERPT_SIZE = 11;
const EXCERPT_LINE = EXCERPT_SIZE * 1.45;
const EXCERPT_MAX_LINES = 4;
const META_SIZE = 9;
const META_LINE = META_SIZE * 1.3;
const GAP = 4;

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
	/** Masked region holding cover + text; hard clip against the card frame. */
	body: Container;
	clip: Graphics;
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
	if (filePreviewKind(item.snapshot) !== "cover") return 0;
	const ideal = Math.round(height * COVER_RATIO);
	// Never let the cover swallow the body: a short, resized card still needs
	// room for the title, otherwise the node becomes an anonymous image plate.
	return Math.max(0, Math.min(ideal, height - MIN_BODY_FOR_COVER));
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

/**
 * Join already-wrapped lines and append an ellipsis to the last one.
 * Pure helper so the clamp can be unit-tested without a Pixi canvas.
 */
export function ellipsizeWrappedLines(
	lines: string[],
	maxLines: number,
): string {
	if (maxLines <= 0 || lines.length === 0) return "";
	if (lines.length <= maxLines) return lines.join("\n");
	const kept = lines.slice(0, maxLines);
	const lastIndex = kept.length - 1;
	const last = (kept[lastIndex] ?? "").replace(/\s+$/u, "");
	kept[lastIndex] = last ? `${last}…` : "…";
	return kept.join("\n");
}

/**
 * Shorten `line` so `line + "…"` fits in `wrapWidth`.
 *
 * Binary search over the prefix: O(log n) single-line measures. Callers pass a
 * measure callback so this stays free of Pixi types and easy to unit-test.
 */
export function fitLineWithEllipsis(
	line: string,
	wrapWidth: number,
	measureWidth: (value: string) => number,
): string {
	const trimmed = line.replace(/\s+$/u, "");
	if (!trimmed) return "…";
	const full = `${trimmed}…`;
	if (measureWidth(full) <= wrapWidth) return full;

	let lo = 0;
	let hi = trimmed.length;
	let best = "…";
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const candidate = mid > 0 ? `${trimmed.slice(0, mid)}…` : "…";
		if (measureWidth(candidate) <= wrapWidth) {
			best = candidate;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return best;
}

/**
 * Fit a Pixi text node into a fixed line budget.
 *
 * Pixi Text has no built-in max-lines / ellipsis, so we measure with the same
 * style the node will render, keep the leading wrapped lines, and mark a cut
 * with an ellipsis. Returning early when everything fits avoids an extra
 * texture rebuild on the common path.
 *
 * Cost is one wrap of a length-capped sample, plus at most a binary search on
 * the last kept line. No character-by-character multi-line remeasure.
 */
export function fitTextToLines(
	text: Text,
	value: string,
	maxLines: number,
	wrapWidth: number,
): void {
	const width = Math.max(1, wrapWidth);
	text.style.wordWrapWidth = width;
	if (!value || maxLines <= 0) {
		if (text.text !== "") text.text = "";
		return;
	}

	// Even at 1px glyphs a line cannot hold more than `width` characters.
	// Cap before measuring so a 480-char excerpt does not pay for lines that
	// will be discarded (cards only ever show a handful).
	const charCap = Math.max(maxLines * Math.ceil(width), maxLines * 4);
	const sample = value.length > charCap ? value.slice(0, charCap) : value;
	const metrics = CanvasTextMetrics.measureText(sample, text.style);
	const overflowed = metrics.lines.length > maxLines || sample !== value;
	if (!overflowed) {
		if (text.text !== value) text.text = value;
		return;
	}

	const keptCount = Math.min(maxLines, metrics.lines.length);
	const kept = metrics.lines.slice(0, keptCount);
	const lastIndex = kept.length - 1;
	// One cloned style for all single-line probes — avoids dirtying the live
	// node and avoids re-cloning inside the binary search.
	const probe = text.style.clone();
	probe.wordWrap = false;
	kept[lastIndex] = fitLineWithEllipsis(
		kept[lastIndex] ?? "",
		width,
		(candidate) => CanvasTextMetrics.measureText(candidate, probe).width,
	);
	const fitted = kept.join("\n");
	if (text.text !== fitted) text.text = fitted;
}

/** How many full lines of `lineHeight` fit in `room`, capped at `max`. */
function linesInRoom(room: number, lineHeight: number, max: number): number {
	if (room < lineHeight * 0.85) return 0;
	return Math.max(0, Math.min(max, Math.floor((room + 0.5) / lineHeight)));
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

function syncClip(parts: FileParts, width: number, height: number) {
	parts.clip
		.clear()
		.roundRect(0, 0, Math.max(1, width), Math.max(1, height), RADIUS)
		.fill({ color: 0xffffff });
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
	const key = context.assetKey(item);
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
		context.colorScheme,
		context.palette.surface,
	].join("|");

	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;

		// Hard clip first: every later paint is bounded by the node frame.
		syncClip(parts, width, height);

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
		context.palette.muted,
	].join("|");
	if (textSig === parts.textSig) return;
	parts.textSig = textSig;

	const top = band > 0 ? band + PADDING * 0.8 : PADDING;
	const bottom = height - PADDING;
	const showMeta = detail === "full";
	// Reserve a meta row only when there is room for it under the title line.
	const metaFits = showMeta && bottom - top >= TITLE_LINE + GAP + META_LINE;
	const metaHeight = metaFits ? META_LINE : 0;
	const contentBottom = bottom - metaHeight - (metaFits ? GAP : 0);

	const titleRoom = Math.max(0, contentBottom - top);
	const titleLines = linesInRoom(titleRoom, TITLE_LINE, TITLE_MAX_LINES);
	parts.title.style.fill = context.palette.text;
	fitTextToLines(parts.title, title, titleLines, innerWidth);
	parts.title.position.set(PADDING, top);
	parts.title.visible = titleLines > 0;

	if (detail !== "full") {
		parts.excerpt.visible = false;
		parts.meta.visible = false;
		return;
	}

	if (metaFits) {
		if (parts.meta.text !== meta) parts.meta.text = meta;
		parts.meta.style.fill = context.palette.muted;
		// Single-line meta: pin to the bottom padding edge.
		parts.meta.position.set(
			PADDING,
			height - PADDING - Math.min(parts.meta.height, META_LINE),
		);
		// Soft horizontal clip via width — mask is the hard floor if it still runs long.
		parts.meta.visible = true;
	} else {
		parts.meta.visible = false;
	}

	const excerptTop = top + (titleLines > 0 ? parts.title.height + GAP : 0);
	const excerptRoom = contentBottom - excerptTop;
	const excerptLines = linesInRoom(excerptRoom, EXCERPT_LINE, EXCERPT_MAX_LINES);
	const showExcerpt = Boolean(excerpt) && excerptLines > 0;
	if (showExcerpt) {
		parts.excerpt.style.fill = context.palette.muted;
		fitTextToLines(parts.excerpt, excerpt, excerptLines, innerWidth);
		parts.excerpt.position.set(PADDING, excerptTop);
	}
	parts.excerpt.visible = showExcerpt;
}

export const fileCardRenderer: BoardCardRenderer = {
	id: "file-card",
	canRender: (item) => item.type === "file",
	create: (item, context) => {
		const root = new Container();
		const plate = new Graphics();
		const body = new Container();
		const clip = new Graphics();
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
				breakWords: true,
				lineHeight: TITLE_LINE,
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
				breakWords: true,
				lineHeight: EXCERPT_LINE,
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

		// Clip applies to body only so the plate stroke is not half-cut by the mask.
		body.mask = clip;
		body.addChild(cover, coverMask, title, excerpt, meta);
		root.addChild(plate, body, clip);
		partsByContainer.set(root, {
			root,
			plate,
			body,
			clip,
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
