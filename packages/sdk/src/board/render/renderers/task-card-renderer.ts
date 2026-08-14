import {
	BOARD_FONT_STACK,
	BOARD_MONO_FONT_STACK,
} from "@cohub/protocol/board-constants";
import type { BoardTaskItem } from "@cohub/protocol/board-document";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import {
	syncTextResolution,
	textResolutionForZoom,
} from "../text-resolution.js";
import { positionShell } from "./base-card-renderer.js";
import type {
	BoardCardRenderer,
	BoardRenderContext,
} from "./board-renderer-registry.js";
import { drawFarPlate } from "./far-plate.js";
import { fitTextToLines } from "./file-card-renderer.js";

/**
 * Task card renderer.
 *
 * A task node is a *reference* to a task run, so the card shows only what makes
 * it recognisable at a glance: what was asked, how it ended, and one preview of
 * what came out. Everything else — full prompt, parameters, every output block,
 * raw result — belongs to the task detail view the card opens.
 *
 * Multimodal outputs each get an honest representation rather than a shared
 * "has output" placeholder: stills and video frames paint their texture, audio
 * paints a waveform (audio has no frame to show, and a generic icon would say
 * nothing about the clip), and text paints its excerpt. That way the medium is
 * readable from the card itself, at any zoom where the card is readable at all.
 *
 * Cost follows the same rules as the file card: two detail tiers keyed on zoom,
 * a signature guard so an unchanged card re-renders nothing, and a hard clip so
 * content can never paint outside the frame.
 */

const RADIUS = 5;
const PADDING = 10;
const HEADER_HEIGHT = 42;
const FOOTER_HEIGHT = 26;
const FULL_DETAIL_ZOOM = 0.55;

/** Bars drawn for an audio preview. Fixed count keeps the geometry batched. */
const WAVEFORM_BARS = 40;
const WAVEFORM_GAP = 2;
/** Play badge radius for a video preview. */
const PLAY_BADGE_RADIUS = 15;

type TaskParts = {
	root: Container;
	plate: Graphics;
	clip: Graphics;
	previewBg: Graphics;
	preview: Sprite;
	previewMask: Graphics;
	/** Waveform bars, play badge, and the running indicator all batch here. */
	previewArt: Graphics;
	title: Text;
	status: Text;
	body: Text;
	meta: Text;
	statusDot: Graphics;
	assetKey: string | null;
	visualSig: string;
	textSig: string;
	resolution: number;
};

const partsByContainer = new WeakMap<Container, TaskParts>();

function statusLabel(status: BoardTaskItem["snapshot"]["status"]) {
	switch (status) {
		case "completed":
			return "Done";
		case "failed":
			return "Failed";
		case "running":
			return "Running";
		default:
			return "Queued";
	}
}

function statusColor(item: BoardTaskItem, context: BoardRenderContext) {
	switch (item.snapshot.status) {
		case "completed":
			return context.colors.green.stroke;
		case "failed":
			return context.colors.rose.stroke;
		case "running":
			return context.colors.brand.stroke;
		default:
			return context.colors.neutral.stroke;
	}
}

/**
 * The preview treatment a card should paint.
 *
 * Derived from the snapshot rather than stored, so a card can never disagree
 * with the task facts it carries.
 */
type PreviewKind = "texture" | "waveform" | "text" | "empty";

function previewKindFor(
	item: BoardTaskItem,
	hasTexture: boolean,
): PreviewKind {
	const output = item.snapshot.primaryOutput;
	if (!output) return "empty";
	if (output.type === "image" || output.type === "video")
		return hasTexture ? "texture" : "empty";
	if (output.type === "audio") return "waveform";
	return output.textExcerpt ? "text" : "empty";
}

/** Placeholder line for a card with nothing to paint yet. */
function emptyLabel(item: BoardTaskItem): string {
	const output = item.snapshot.primaryOutput;
	switch (item.snapshot.status) {
		case "running":
			return "Generating…";
		case "pending":
			return "Queued";
		case "failed":
			return "No output";
		default:
			if (output?.type === "image") return "Image output";
			if (output?.type === "video") return "Video output";
			return "No preview";
	}
}

/**
 * Deterministic bar heights for an audio clip.
 *
 * The real waveform would require decoding the audio, which a board card must
 * never do — so this is explicitly a *stable visual identity* for the clip, not
 * a measurement: the same task always draws the same shape, and two different
 * clips are visually distinct. Cheap enough to recompute on every resize.
 */
function waveformBars(seed: string, count: number): number[] {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	const bars: number[] = [];
	for (let index = 0; index < count; index += 1) {
		hash ^= hash << 13;
		hash ^= hash >>> 17;
		hash ^= hash << 5;
		hash >>>= 0;
		// Bias towards the middle so the shape reads as a clip, not as noise.
		const unit = (hash % 1000) / 1000;
		const envelope = Math.sin((Math.PI * (index + 0.5)) / count);
		bars.push(0.18 + unit * 0.82 * (0.45 + envelope * 0.55));
	}
	return bars;
}

/** Scale a texture into the preview band without cropping or distortion. */
function containRect(
	width: number,
	height: number,
	imageWidth: number,
	imageHeight: number,
) {
	if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0)
		return { x: 0, y: 0, width: 0, height: 0 };
	const scale = Math.min(width / imageWidth, height / imageHeight);
	const renderedWidth = imageWidth * scale;
	const renderedHeight = imageHeight * scale;
	return {
		x: (width - renderedWidth) / 2,
		y: (height - renderedHeight) / 2,
		width: renderedWidth,
		height: renderedHeight,
	};
}

function drawWaveform(
	graphics: Graphics,
	seed: string,
	rect: { x: number; y: number; width: number; height: number },
	color: number,
) {
	const count = Math.max(
		8,
		Math.min(WAVEFORM_BARS, Math.floor(rect.width / (WAVEFORM_GAP + 2))),
	);
	const step = rect.width / count;
	const barWidth = Math.max(1.5, step - WAVEFORM_GAP);
	const centerY = rect.y + rect.height / 2;
	const maxHeight = Math.max(2, rect.height * 0.72);
	const bars = waveformBars(seed, count);
	for (let index = 0; index < count; index += 1) {
		const amplitude = (bars[index] ?? 0.4) * maxHeight;
		graphics.roundRect(
			rect.x + index * step + (step - barWidth) / 2,
			centerY - amplitude / 2,
			barWidth,
			amplitude,
			barWidth / 2,
		);
	}
	graphics.fill({ color, alpha: 0.72 });
}

function drawPlayBadge(
	graphics: Graphics,
	rect: { x: number; y: number; width: number; height: number },
	context: BoardRenderContext,
) {
	const radius = Math.min(
		PLAY_BADGE_RADIUS,
		Math.max(8, Math.min(rect.width, rect.height) * 0.22),
	);
	const cx = rect.x + rect.width / 2;
	const cy = rect.y + rect.height / 2;
	graphics
		.circle(cx, cy, radius)
		.fill({ color: context.palette.bg, alpha: 0.58 });
	const size = radius * 0.72;
	graphics
		.moveTo(cx - size * 0.34, cy - size * 0.56)
		.lineTo(cx + size * 0.62, cy)
		.lineTo(cx - size * 0.34, cy + size * 0.56)
		.closePath()
		.fill({ color: context.palette.text, alpha: 0.92 });
}

/**
 * Indeterminate progress rail for an in-flight task. Drawn as a static partial
 * bar rather than an animation: a board can hold many running tasks at once, and
 * a per-card ticker would keep the whole stage redrawing.
 */
function drawRunningRail(
	graphics: Graphics,
	rect: { x: number; y: number; width: number; height: number },
	color: number,
) {
	const railHeight = 2;
	const y = rect.y + rect.height - railHeight;
	graphics
		.rect(rect.x, y, rect.width, railHeight)
		.fill({ color, alpha: 0.18 })
		.rect(rect.x, y, rect.width * 0.42, railHeight)
		.fill({ color, alpha: 0.85 });
}

function sync(
	container: Container,
	item: BoardTaskItem,
	context: BoardRenderContext,
) {
	const parts = partsByContainer.get(container);
	if (!parts) return;
	positionShell(parts.root, item);

	const { width, height } = item.frame;
	const selected = context.selectedIds.has(item.id);
	const hovered = context.hoveredId === item.id;
	const full = context.zoom >= FULL_DETAIL_ZOOM;
	const color = statusColor(item, context);

	// Reference counting is per card, so a card adopted by a different task
	// releases the previous preview before acquiring the new one.
	const key = context.assetKey(item);
	if (key !== parts.assetKey) {
		if (parts.assetKey) context.releaseTexture(parts.assetKey);
		parts.assetKey = key;
		if (key) context.acquireTexture(key);
	}
	const texture = key ? context.getTexture(key) : null;

	const headerHeight = Math.min(HEADER_HEIGHT, height);
	const footerHeight = height >= 82 ? FOOTER_HEIGHT : 0;
	const band = {
		x: 1,
		y: headerHeight,
		width: Math.max(1, width - 2),
		height: Math.max(0, height - headerHeight - footerHeight - 1),
	};
	const kind = previewKindFor(item, Boolean(texture));
	const running = item.snapshot.status === "running";

	syncTextResolution(parts.title, parts, context.zoom);
	syncTextResolution(parts.status, parts, context.zoom);
	syncTextResolution(parts.body, parts, context.zoom);
	syncTextResolution(parts.meta, parts, context.zoom);

	const visualSig = [
		width,
		height,
		selected,
		hovered,
		color,
		kind,
		running,
		item.taskRunId,
		texture ? `${texture.width}x${texture.height}` : "none",
		context.palette.surface,
		context.palette.hover,
		context.palette.border,
		context.palette.bg,
	].join("|");

	if (visualSig !== parts.visualSig) {
		parts.visualSig = visualSig;

		parts.plate
			.clear()
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
				alpha: selected ? 0.96 : 0.82,
			});

		// Hard clip: nothing a card paints may escape its frame.
		parts.clip
			.clear()
			.roundRect(1, 1, Math.max(1, width - 2), Math.max(1, height - 2), RADIUS - 1)
			.fill({ color: 0xffffff });

		parts.previewBg.clear();
		parts.previewMask.clear();
		parts.previewArt.clear();

		if (band.height > 0) {
			parts.previewBg
				.rect(band.x, band.y, band.width, band.height)
				.fill({ color: context.palette.hover, alpha: 0.5 });
			parts.previewMask
				.rect(band.x, band.y, band.width, band.height)
				.fill({ color: 0xffffff });

			if (kind === "waveform" && full) {
				drawWaveform(
					parts.previewArt,
					item.taskRunId,
					{
						x: band.x + PADDING,
						y: band.y,
						width: Math.max(1, band.width - PADDING * 2),
						height: band.height,
					},
					color,
				);
			}
			if (
				kind === "texture" &&
				item.snapshot.primaryOutput?.type === "video" &&
				full
			) {
				drawPlayBadge(parts.previewArt, band, context);
			}
			if (running) drawRunningRail(parts.previewArt, band, color);
		}

		parts.statusDot.clear().circle(0, 0, 3).fill({ color, alpha: 0.96 });
	}

	// Sprite geometry is positioned every sync (cheap) so a texture arriving
	// after the signature settled still lands in the right place.
	parts.preview.visible = kind === "texture" && band.height > 0;
	if (parts.preview.visible && texture) {
		const fitted = containRect(
			band.width,
			band.height,
			texture.width,
			texture.height,
		);
		parts.preview.texture = texture;
		parts.preview.position.set(band.x + fitted.x, band.y + fitted.y);
		parts.preview.width = fitted.width;
		parts.preview.height = fitted.height;
	}

	const outputSuffix =
		item.snapshot.outputCount > 1 ? `+${item.snapshot.outputCount - 1}` : null;
	const meta = [item.snapshot.model ?? item.snapshot.taskType, outputSuffix]
		.filter(Boolean)
		.join("  ·  ");
	// Text output paints its excerpt; every other medium speaks through the
	// preview band, so a redundant caption would only add noise.
	const bodyText =
		kind === "text"
			? (item.snapshot.primaryOutput?.textExcerpt ?? "")
			: kind === "empty"
				? emptyLabel(item)
				: "";

	const textSig = [
		item.snapshot.title,
		item.snapshot.status,
		bodyText,
		meta,
		full,
		width,
		height,
		band.height,
		context.palette.text,
		context.palette.muted,
		color,
	].join("|");

	if (textSig !== parts.textSig) {
		parts.textSig = textSig;
		parts.status.text = statusLabel(item.snapshot.status);
		parts.status.style.fill = color;
		parts.title.style.fill = context.palette.text;
		// The status pill is laid out first so the title can only claim the space
		// actually left over — a long title truncates instead of colliding.
		fitTextToLines(
			parts.title,
			item.snapshot.title,
			2,
			Math.max(24, width - PADDING * 2 - parts.status.width - 16),
		);
		parts.body.style.fill =
			kind === "text" ? context.palette.text : context.palette.muted;
		fitTextToLines(
			parts.body,
			bodyText,
			Math.max(1, Math.floor((band.height - PADDING) / 16)),
			Math.max(24, band.width - PADDING * 2),
		);
		parts.meta.style.fill = context.palette.muted;
		fitTextToLines(parts.meta, meta, 1, Math.max(24, width - PADDING * 2));
	}

	parts.title.visible = full;
	parts.status.visible = full;
	parts.body.visible = full && bodyText.length > 0 && band.height >= 24;
	parts.meta.visible = full && footerHeight > 0;

	parts.status.position.set(width - PADDING - parts.status.width, 13);
	parts.statusDot.position.set(
		width - PADDING - parts.status.width - 8,
		13 + parts.status.height / 2,
	);
	parts.title.position.set(PADDING, 11);
	parts.body.position.set(
		band.x + PADDING,
		kind === "text"
			? band.y + PADDING
			: band.y + Math.max(0, (band.height - parts.body.height) / 2),
	);
	parts.meta.position.set(PADDING, height - footerHeight + 5);
}

export const taskCardRenderer: BoardCardRenderer = {
	id: "task-card",
	canRender: (item) => item.type === "task",
	create: (item, context) => {
		const root = new Container();
		const plate = new Graphics();
		const clip = new Graphics();
		const previewBg = new Graphics();
		const preview = new Sprite();
		const previewMask = new Graphics();
		const previewArt = new Graphics();
		const statusDot = new Graphics();
		const resolution = textResolutionForZoom(context.zoom);
		const label = (
			fontSize: number,
			fontFamily = BOARD_FONT_STACK,
			fontWeight: "400" | "500" | "600" = "500",
		) =>
			new Text({
				text: "",
				style: {
					fontFamily,
					fontSize,
					fontWeight,
					wordWrap: true,
					breakWords: true,
				},
				resolution,
				roundPixels: true,
			});
		const title = label(12.5, BOARD_FONT_STACK, "600");
		const status = label(10, BOARD_FONT_STACK, "500");
		const body = label(11.5);
		const meta = label(10, BOARD_MONO_FONT_STACK, "400");

		preview.mask = previewMask;
		root.mask = clip;
		root.addChild(
			plate,
			clip,
			previewBg,
			preview,
			previewMask,
			previewArt,
			title,
			statusDot,
			status,
			body,
			meta,
		);
		partsByContainer.set(root, {
			root,
			plate,
			clip,
			previewBg,
			preview,
			previewMask,
			previewArt,
			title,
			status,
			body,
			meta,
			statusDot,
			assetKey: null,
			visualSig: "",
			textSig: "",
			resolution,
		});
		if (item.type === "task") sync(root, item, context);
		return root;
	},
	update: (container, item, context) => {
		if (item.type === "task") sync(container, item, context);
	},
	// Far LOD: a neutral plate with a status-coloured band, so a dense board still
	// reads as a map of what finished, what failed, and what is still running.
	renderFar: (graphics, item, context) => {
		if (item.type !== "task") return;
		drawFarPlate(graphics, item.frame, {
			fill: context.palette.surface,
			fillAlpha: 0.82,
			accent: statusColor(item, context),
			accentAlpha: 0.9,
		});
	},
	destroy: (container, context) => {
		const parts = partsByContainer.get(container);
		if (parts?.assetKey) context.releaseTexture(parts.assetKey);
		parts?.root.destroy({ children: true });
		partsByContainer.delete(container);
	},
};
