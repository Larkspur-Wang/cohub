/**
 * Free-arrow geometry.
 *
 * An arrow is a standalone annotation stroke between two world points — it does
 * not relate nodes. Node relations are `BoardConnection`s, which resolve their
 * geometry from the nodes they join (see ./connections). Keeping the two apart is
 * what makes each one simple: an arrow owns absolute coordinates and needs no
 * lookup, while a connection owns no coordinates at all.
 */

import {
	type Rect,
	type WorldPoint,
	worldPoint,
} from "../geometry.js";
import type { BoardArrowItem, BoardFrame, BoardPoint } from "@cohub/protocol/board-document";

export type ResolvedArrow = {
	start: WorldPoint;
	end: WorldPoint;
	/** Quadratic control point (already bent); the midpoint when bend is 0. */
	control: WorldPoint;
};

/** Resolve an arrow's endpoints and its bent control point. */
export function resolveArrow(item: BoardArrowItem): ResolvedArrow {
	const start = worldPoint(item.start.x, item.start.y);
	const end = worldPoint(item.end.x, item.end.y);
	const mid = worldPoint((start.x + end.x) / 2, (start.y + end.y) / 2);
	if (!item.bend) return { start, end, control: mid };
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const length = Math.hypot(dx, dy) || 1;
	const offset = item.bend * length;
	return {
		start,
		end,
		control: worldPoint(mid.x + (-dy / length) * offset, mid.y + (dx / length) * offset),
	};
}

/** Sample an arrow's quadratic curve into world points. */
export function sampleArrow(resolved: ResolvedArrow, segments: number): WorldPoint[] {
	const { start, control, end } = resolved;
	const out: WorldPoint[] = [];
	for (let index = 0; index <= segments; index += 1) {
		const t = index / segments;
		const mt = 1 - t;
		out.push(
			worldPoint(
				mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
				mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
			),
		);
	}
	return out;
}

/** World bounds of an arrow, padded for its stroke. */
export function arrowBounds(item: BoardArrowItem): Rect {
	const samples = sampleArrow(resolveArrow(item), 12);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const point of samples) {
		minX = Math.min(minX, point.x);
		minY = Math.min(minY, point.y);
		maxX = Math.max(maxX, point.x);
		maxY = Math.max(maxY, point.y);
	}
	const pad = Math.max(8, item.size * 2);
	return {
		x: minX - pad,
		y: minY - pad,
		width: Math.max(1, maxX - minX + pad * 2),
		height: Math.max(1, maxY - minY + pad * 2),
	};
}

/** The frame an arrow should carry, derived from its endpoints. */
export function arrowFrame(item: BoardArrowItem): BoardFrame {
	return { ...arrowBounds(item), rotation: 0 };
}

/** Distance from a world point to an arrow's curve (hit testing). */
export function distanceToArrow(item: BoardArrowItem, point: WorldPoint): number {
	const samples = sampleArrow(resolveArrow(item), 16);
	let min = Number.POSITIVE_INFINITY;
	for (let index = 0; index < samples.length - 1; index += 1) {
		const from = samples[index];
		const to = samples[index + 1];
		if (!from || !to) continue;
		const distance = segmentDistance(point, from, to);
		if (distance < min) min = distance;
	}
	return min;
}

function segmentDistance(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
	const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Translate an arrow by a delta, keeping its frame consistent. */
export function translateArrow(item: BoardArrowItem, dx: number, dy: number): BoardArrowItem {
	const move = (point: BoardPoint): BoardPoint => ({ x: point.x + dx, y: point.y + dy });
	const next: BoardArrowItem = { ...item, start: move(item.start), end: move(item.end) };
	return { ...next, frame: arrowFrame(next) };
}
