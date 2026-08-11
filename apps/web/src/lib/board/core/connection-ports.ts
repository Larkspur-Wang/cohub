/**
 * Connection ports — the four handles a relation can be dragged from.
 *
 * Ports are pure geometry so the editor, the overlay renderer and tests agree on
 * exactly where they are and how large their hit area is. They exist in screen
 * space conceptually (a constant size regardless of zoom) but are expressed in
 * world space, which is what the stage draws in.
 */

import {
	type BoardConnectionSide,
	type BoardFrame,
	degToRad,
	frameRect,
	rectCenter,
	rotatePointAround,
	type WorldPoint,
	worldPoint,
} from "@neta-art/cohub/board";

export const CONNECTION_SIDES: readonly BoardConnectionSide[] = [
	"top",
	"right",
	"bottom",
	"left",
] as const;

/**
 * Distance from the node edge to the port center, in screen px.
 *
 * Sits outside the node so a port never covers the content it belongs to, and so
 * a drag from a port is unambiguous against a drag of the node itself.
 */
export const CONNECTION_PORT_OFFSET = 14;
/** Drawn radius in screen px. Small enough to stay quiet on an idle node. */
export const CONNECTION_PORT_RADIUS = 4;
/**
 * Grab radius in screen px, independent of the drawn radius.
 *
 * Comfortably larger than the dot so the ports are easy to hit with a mouse, and
 * larger still for touch (see `portHitRadius`) where there is no cursor to aim
 * with and the finger occludes the target.
 */
export const CONNECTION_PORT_HIT_RADIUS = 11;
export const CONNECTION_PORT_TOUCH_HIT_RADIUS = 22;

export type ConnectionPort = {
	side: BoardConnectionSide;
	/** Port center in world space. */
	point: WorldPoint;
};

export function portHitRadius(pointerType: string): number {
	return pointerType === "touch" || pointerType === "pen"
		? CONNECTION_PORT_TOUCH_HIT_RADIUS
		: CONNECTION_PORT_HIT_RADIUS;
}

const SIDE_NORMAL: Record<BoardConnectionSide, { x: number; y: number }> = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

const SIDE_ANCHOR: Record<BoardConnectionSide, { nx: number; ny: number }> = {
	top: { nx: 0.5, ny: 0 },
	right: { nx: 1, ny: 0.5 },
	bottom: { nx: 0.5, ny: 1 },
	left: { nx: 0, ny: 0.5 },
};

/**
 * The four ports of a node at a given zoom.
 *
 * The offset is divided by zoom so ports keep a constant on-screen distance from
 * the node: at low zoom they stay reachable instead of collapsing into the edge,
 * and at high zoom they do not drift far away from it.
 */
export function connectionPorts(
	frame: BoardFrame,
	zoom: number,
): ConnectionPort[] {
	const offset = CONNECTION_PORT_OFFSET / Math.max(zoom, 0.0001);
	const center = rectCenter(frameRect(frame));
	const rotation = frame.rotation ? degToRad(frame.rotation) : 0;
	return CONNECTION_SIDES.map((side) => {
		const anchor = SIDE_ANCHOR[side];
		const base = worldPoint(
			frame.x + anchor.nx * frame.width,
			frame.y + anchor.ny * frame.height,
		);
		const rotated = rotation ? rotatePointAround(base, center, rotation) : base;
		const normal = SIDE_NORMAL[side];
		const direction = rotation
			? {
					x: normal.x * Math.cos(rotation) - normal.y * Math.sin(rotation),
					y: normal.x * Math.sin(rotation) + normal.y * Math.cos(rotation),
				}
			: normal;
		return {
			side,
			point: worldPoint(
				rotated.x + direction.x * offset,
				rotated.y + direction.y * offset,
			),
		};
	});
}

/** The port under a world point, or null. */
export function connectionPortAt(
	frame: BoardFrame,
	point: WorldPoint,
	zoom: number,
	pointerType: string,
): ConnectionPort | null {
	const radius = portHitRadius(pointerType) / Math.max(zoom, 0.0001);
	let closest: ConnectionPort | null = null;
	let closestDistance = Number.POSITIVE_INFINITY;
	for (const port of connectionPorts(frame, zoom)) {
		const distance = Math.hypot(port.point.x - point.x, port.point.y - point.y);
		if (distance <= radius && distance < closestDistance) {
			closest = port;
			closestDistance = distance;
		}
	}
	return closest;
}
