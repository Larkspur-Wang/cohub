/**
 * Connection drawing.
 *
 * Connections render into one shared layer beneath the cards rather than as a
 * container per relation. A connection is a thin stroke with no texture and no
 * interactive chrome of its own, so a per-connection container would add a
 * transform, a render group and a draw call each for geometry that batches
 * perfectly — on a densely connected board that is the difference between a few
 * draw calls and a few thousand.
 *
 * Labels are the exception: text needs its own object to rasterise, so a `Text`
 * is materialised only for connections that actually carry one and is pooled by
 * connection id.
 */

import { BOARD_FONT_STACK } from "@cohub/protocol/board-constants";
import type { BoardConnection } from "@cohub/protocol/board-connection";
import type { BoardFrame } from "@cohub/protocol/board-document";
import { Container, Graphics, Text } from "pixi.js";
import {
	connectionArrowheads,
	type FrameLookup,
	type ResolvedConnection,
	resolveConnection,
} from "../core/connections.js";
import { pickBoardColor } from "../core/palette.js";
import type { BoardShapeColors } from "../core/palette.js";
import { syncTextResolution, textResolutionForZoom } from "./text-resolution.js";

/** Arrowhead length relative to stroke width, and its floor in world units. */
const HEAD_SCALE = 5.5;
const HEAD_MIN = 11;
const HEAD_SPREAD = Math.PI / 6;
/** Dash pattern for `dashed` connections, in world units. */
const DASH_LENGTH = 10;
const DASH_GAP = 7;

export type ConnectionRenderInput = {
	connections: readonly BoardConnection[];
	getFrame: FrameLookup;
	colors: BoardShapeColors;
	colorScheme: "dark" | "light";
	zoom: number;
	/** Connections drawn in their selected state. */
	selectedIds?: ReadonlySet<string>;
	/** Connection under the pointer, if any. */
	hoveredId?: string | null;
	/**
	 * Ids to skip because the host is drawing them itself this frame (e.g. a live
	 * drag preview on the interaction overlay). Skipping avoids the doubled stroke
	 * of a preview drawn over its own committed geometry.
	 */
	skipIds?: ReadonlySet<string>;
};

export type ConnectionLayer = {
	/** Redraw every connection. Cheap: one Graphics, batched. */
	sync: (input: ConnectionRenderInput) => void;
	/** Resolved geometry from the last sync, for hit testing and overlays. */
	resolved: (connectionId: string) => ResolvedConnection | null;
	/**
	 * The display objects this layer owns, so a host can place them in its own
	 * z-ordering scheme without the layer needing to know about it.
	 */
	readonly children: readonly Container[];
	destroy: () => void;
};

/** Draw an open chevron arrowhead aimed along `angle`. */
function drawArrowhead(
	graphics: Graphics,
	tip: { x: number; y: number },
	angle: number,
	size: number,
	color: number,
	width: number,
	alpha: number,
) {
	graphics
		.moveTo(
			tip.x - size * Math.cos(angle - HEAD_SPREAD),
			tip.y - size * Math.sin(angle - HEAD_SPREAD),
		)
		.lineTo(tip.x, tip.y)
		.lineTo(
			tip.x - size * Math.cos(angle + HEAD_SPREAD),
			tip.y - size * Math.sin(angle + HEAD_SPREAD),
		)
		.stroke({ color, width, alpha, cap: "round", join: "round" });
}

/** Trace a polyline as a dashed path, walking segment by segment. */
function traceDashed(graphics: Graphics, path: readonly { x: number; y: number }[]) {
	let penDown = true;
	let remaining = DASH_LENGTH;
	let current = path[0];
	if (!current) return;
	graphics.moveTo(current.x, current.y);
	for (let index = 1; index < path.length; index += 1) {
		const next = path[index];
		if (!next) continue;
		let segmentRemaining = Math.hypot(next.x - current.x, next.y - current.y);
		let from = current;
		while (segmentRemaining > 0.0001) {
			const step = Math.min(segmentRemaining, remaining);
			const ratio = step / segmentRemaining;
			const to = {
				x: from.x + (next.x - from.x) * ratio,
				y: from.y + (next.y - from.y) * ratio,
			};
			if (penDown) graphics.lineTo(to.x, to.y);
			else graphics.moveTo(to.x, to.y);
			remaining -= step;
			segmentRemaining -= step;
			from = to;
			if (remaining <= 0.0001) {
				penDown = !penDown;
				remaining = penDown ? DASH_LENGTH : DASH_GAP;
			}
		}
		current = next;
	}
}

export function createConnectionLayer(options: {
	/** World-space container the layer attaches to. */
	parent: Container;
	/** zIndex applied to the layer's display objects once they exist. */
	zIndex?: number;
}): ConnectionLayer {
	// Display objects are created on first use, not up front: most boards have no
	// relations at all, and an unused Graphics still costs an allocation, a child on
	// the world container and a slot in every sort of its children.
	let graphics: Graphics | null = null;
	let labelLayer: Container | null = null;

	const labels = new Map<string, { text: Text; resolution: number; sig: string }>();
	let resolvedById = new Map<string, ResolvedConnection>();

	function ensureAttached(): { graphics: Graphics; labelLayer: Container } {
		if (graphics && labelLayer) return { graphics, labelLayer };
		const nextGraphics = new Graphics({ label: "board-connections" });
		const nextLabels = new Container({ label: "board-connection-labels" });
		if (options.zIndex !== undefined) {
			nextGraphics.zIndex = options.zIndex;
			nextLabels.zIndex = options.zIndex;
		}
		options.parent.addChild(nextGraphics, nextLabels);
		graphics = nextGraphics;
		labelLayer = nextLabels;
		return { graphics: nextGraphics, labelLayer: nextLabels };
	}

	function releaseLabel(connectionId: string) {
		const entry = labels.get(connectionId);
		if (!entry) return;
		labelLayer?.removeChild(entry.text);
		entry.text.destroy();
		labels.delete(connectionId);
	}

	function syncLabel(
		connection: BoardConnection,
		resolved: ResolvedConnection,
		input: ConnectionRenderInput,
		color: number,
		host: Container,
	) {
		const value = connection.label.trim();
		if (!value) {
			releaseLabel(connection.id);
			return;
		}
		let entry = labels.get(connection.id);
		if (!entry) {
			const resolution = textResolutionForZoom(input.zoom);
			const text = new Text({
				text: value,
				style: {
					fill: color,
					fontFamily: BOARD_FONT_STACK,
					fontSize: 12,
					fontWeight: "500",
				},
				resolution,
				roundPixels: true,
			});
			text.anchor.set(0.5);
			host.addChild(text);
			entry = { text, resolution, sig: "" };
			labels.set(connection.id, entry);
		}
		syncTextResolution(entry.text, entry, input.zoom);
		const sig = `${value}|${color}`;
		if (sig !== entry.sig) {
			entry.sig = sig;
			entry.text.text = value;
			entry.text.style.fill = color;
		}
		entry.text.position.set(resolved.mid.x, resolved.mid.y);
	}

	function sync(input: ConnectionRenderInput) {
		// Nothing to draw and nothing drawn before: stay unattached so a board without
		// relations pays nothing at all for the feature.
		if (input.connections.length === 0 && !graphics) {
			resolvedById = new Map();
			return;
		}
		const host = ensureAttached();
		host.graphics.clear();
		const next = new Map<string, ResolvedConnection>();
		const selected = input.selectedIds ?? new Set<string>();
		const skip = input.skipIds;
		// Screen-independent minimum so a thin connection stays visible when zoomed
		// far out, where its world-space width would fall below a pixel.
		const minWidth = 1 / Math.max(input.zoom, 0.0001);

		for (const connection of input.connections) {
			const resolved = resolveConnection(connection, input.getFrame);
			if (!resolved) continue;
			// Resolved geometry is recorded even when the draw is skipped, so hit
			// testing stays correct for a connection the host is previewing.
			next.set(connection.id, resolved);
			if (skip?.has(connection.id)) {
				releaseLabel(connection.id);
				continue;
			}

			const isSelected = selected.has(connection.id);
			const isHovered = input.hoveredId === connection.id;
			const color = pickBoardColor(input.colors, connection.style.color, input.colorScheme);
			const width = Math.max(
				connection.style.size + (isSelected ? 1 : 0),
				minWidth,
			);
			const alpha = isSelected || isHovered ? 1 : 0.9;

			if (connection.style.line === "dashed")
				traceDashed(host.graphics, resolved.path);
			else {
				const first = resolved.path[0];
				if (!first) continue;
				host.graphics.moveTo(first.x, first.y);
				for (let index = 1; index < resolved.path.length; index += 1) {
					const point = resolved.path[index];
					if (point) host.graphics.lineTo(point.x, point.y);
				}
			}
			host.graphics.stroke({
				color: color.stroke,
				width,
				alpha,
				cap: "round",
				join: "round",
			});

			const heads = connectionArrowheads(connection);
			const headSize = Math.max(HEAD_MIN, connection.style.size * HEAD_SCALE);
			if (heads.atTarget) {
				const tip = resolved.path[resolved.path.length - 1];
				const previous = resolved.path[resolved.path.length - 2];
				if (tip && previous) {
					drawArrowhead(
						host.graphics,
						tip,
						Math.atan2(tip.y - previous.y, tip.x - previous.x),
						headSize,
						color.stroke,
						width,
						alpha,
					);
				}
			}
			if (heads.atSource) {
				const tip = resolved.path[0];
				const next2 = resolved.path[1];
				if (tip && next2) {
					drawArrowhead(
						host.graphics,
						tip,
						Math.atan2(tip.y - next2.y, tip.x - next2.x),
						headSize,
						color.stroke,
						width,
						alpha,
					);
				}
			}

			syncLabel(connection, resolved, input, color.label, host.labelLayer);
		}

		// Drop labels for connections that disappeared this frame.
		for (const connectionId of [...labels.keys()]) {
			if (!next.has(connectionId)) releaseLabel(connectionId);
		}
		resolvedById = next;
	}

	return {
		sync,
		resolved: (connectionId) => resolvedById.get(connectionId) ?? null,
		get children() {
			const list: Container[] = [];
			if (graphics) list.push(graphics);
			if (labelLayer) list.push(labelLayer);
			return list;
		},
		destroy: () => {
			for (const entry of labels.values()) entry.text.destroy();
			labels.clear();
			graphics?.destroy();
			labelLayer?.destroy({ children: true });
			graphics = null;
			labelLayer = null;
			resolvedById = new Map();
		},
	};
}

/** Frame lookup over a plain item list, for hosts without an index. */
export function framesFromItems(
	items: readonly { id: string; frame: BoardFrame }[],
): FrameLookup {
	const frames = new Map(items.map((item) => [item.id, item.frame]));
	return (id) => frames.get(id);
}
