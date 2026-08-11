import assert from "node:assert/strict";
import { test } from "node:test";
import { type BoardFrame, worldPoint } from "@neta-art/cohub/board";
import {
	CONNECTION_PORT_HIT_RADIUS,
	CONNECTION_PORT_OFFSET,
	CONNECTION_PORT_TOUCH_HIT_RADIUS,
	connectionPortAt,
	connectionPorts,
} from "../lib/board/core/connection-ports.ts";

/**
 * Ports are the only affordance for creating a relation, so their geometry is the
 * feature's entire entry point: if a port is not where it looks like it is, the
 * relation cannot be started at all.
 */

const frame = (patch: Partial<BoardFrame> = {}): BoardFrame => ({
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
	...patch,
});

test("a node exposes one port per side", () => {
	const ports = connectionPorts(frame(), 1);
	assert.deepEqual(
		ports.map((port) => port.side),
		["top", "right", "bottom", "left"],
	);
});

test("ports sit outside the node, never on top of its content", () => {
	// A port drawn inside the node would cover the content it belongs to and make
	// a port drag indistinguishable from a node drag.
	const f = frame();
	const ports = connectionPorts(f, 1);
	const byside = new Map(ports.map((port) => [port.side, port.point]));
	assert.equal(byside.get("top")?.y, f.y - CONNECTION_PORT_OFFSET);
	assert.equal(
		byside.get("bottom")?.y,
		f.y + f.height + CONNECTION_PORT_OFFSET,
	);
	assert.equal(byside.get("left")?.x, f.x - CONNECTION_PORT_OFFSET);
	assert.equal(byside.get("right")?.x, f.x + f.width + CONNECTION_PORT_OFFSET);
});

test("the port offset is constant on screen, so zoom does not swallow it", () => {
	// Expressed in world space, the offset has to shrink as zoom grows to stay the
	// same distance on screen. Otherwise ports collapse into the border when zoomed
	// out and drift far away when zoomed in.
	const f = frame();
	const at1 = connectionPorts(f, 1).find((port) => port.side === "top");
	const at4 = connectionPorts(f, 4).find((port) => port.side === "top");
	assert.ok(at1 && at4);
	const gap1 = f.y - (at1?.point.y ?? 0);
	const gap4 = f.y - (at4?.point.y ?? 0);
	assert.equal(gap1, CONNECTION_PORT_OFFSET);
	assert.equal(gap4, CONNECTION_PORT_OFFSET / 4);
});

test("ports follow a rotated node", () => {
	// 90° clockwise: the "top" port ends up to the right of the node.
	const f = frame({ rotation: 90 });
	const top = connectionPorts(f, 1).find((port) => port.side === "top");
	assert.ok(top);
	assert.ok(
		(top?.point.x ?? 0) > f.x + f.width,
		"rotated top port should sit past the right edge",
	);
});

test("a pointer on a port hits it; the node centre does not", () => {
	const f = frame();
	const top = connectionPorts(f, 1).find((port) => port.side === "top");
	assert.ok(top);
	const hit = connectionPortAt(f, top?.point ?? worldPoint(0, 0), 1, "mouse");
	assert.equal(hit?.side, "top");
	// The middle of the node is a node drag, not a port grab.
	assert.equal(connectionPortAt(f, worldPoint(50, 50), 1, "mouse"), null);
});

test("touch gets a larger grab radius than the mouse", () => {
	// The drawn dot stays small either way; only the reachable area grows, because
	// a finger has no cursor to aim with and occludes its own target.
	assert.ok(CONNECTION_PORT_TOUCH_HIT_RADIUS > CONNECTION_PORT_HIT_RADIUS);
	const f = frame();
	const top = connectionPorts(f, 1).find((port) => port.side === "top");
	assert.ok(top);
	// A point that misses by more than the mouse radius but less than touch's.
	const nearMiss = worldPoint(
		(top?.point.x ?? 0) + (CONNECTION_PORT_HIT_RADIUS + 4),
		top?.point.y ?? 0,
	);
	assert.equal(connectionPortAt(f, nearMiss, 1, "mouse"), null);
	assert.equal(connectionPortAt(f, nearMiss, 1, "touch")?.side, "top");
});

test("the grab radius is constant on screen too", () => {
	// At high zoom a world-space radius would become a huge grab area, letting a
	// port steal clicks meant for the node.
	const f = frame();
	const top = connectionPorts(f, 4).find((port) => port.side === "top");
	assert.ok(top);
	const justOutside = worldPoint(
		(top?.point.x ?? 0) + (CONNECTION_PORT_HIT_RADIUS + 2) / 4,
		top?.point.y ?? 0,
	);
	assert.equal(connectionPortAt(f, justOutside, 4, "mouse"), null);
});
