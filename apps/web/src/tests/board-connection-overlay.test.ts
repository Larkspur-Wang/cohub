import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultBoardPalette } from "@neta-art/cohub/board/render";
import { createBoardScene } from "../lib/board/board-scene.ts";

/**
 * The overlay is where a relation becomes visible before it exists: the ports you
 * drag from, and the line that follows the pointer. Both were implemented and then
 * never called, which left the feature reachable in state but invisible on screen.
 * These tests assert the draw calls actually happen.
 *
 * The stubs record calls rather than rasterising — the overlay only ever traces
 * geometry, so no GPU or DOM is needed to know whether it drew.
 */

type Call = { op: string; args: unknown[] };

function recordingGraphics(calls: Call[]) {
	const self: Record<string, unknown> = {};
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			calls.push({ op, args });
			return self;
		};
	for (const op of [
		"clear",
		"circle",
		"rect",
		"roundRect",
		"moveTo",
		"lineTo",
		"fill",
		"stroke",
		"destroy",
	])
		self[op] = record(op);
	Object.assign(self, {
		children: [],
		zIndex: 0,
		sortableChildren: false,
		visible: true,
		addChild: record("addChild"),
		removeChild: record("removeChild"),
		sortChildren: record("sortChildren"),
	});
	return self;
}

function setup() {
	const calls: Call[] = [];
	const overlay = recordingGraphics(calls);
	const scene = createBoardScene({
		world: recordingGraphics([]) as never,
		farLayer: recordingGraphics([]) as never,
		overlay: overlay as never,
		getRenderer: (() => ({ id: "stub", canRender: () => true })) as never,
	});
	return { scene, calls };
}

const palette = defaultBoardPalette("light");

/** Overlay input with nothing active, so each test adds only what it asserts. */
const base = {
	zoom: 1,
	pointerType: "mouse",
	marquee: null,
	selection: [] as string[],
	transform: null,
	controls: true,
	hoveredControl: null,
	rotationPointer: null,
};

const frame = {
	x: 200,
	y: 0,
	width: 100,
	height: 100,
	rotation: 0,
};

test("connection ports are drawn as circles", () => {
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			ports: [
				{ x: 50, y: -14, radius: 4 },
				{ x: 114, y: 50, radius: 4 },
			],
		},
		palette,
	);
	const circles = calls.filter((call) => call.op === "circle");
	assert.equal(circles.length, 2);
	assert.deepEqual(circles[0]?.args.slice(0, 2), [50, -14]);
});

test("ports draw even with no selection transform", () => {
	// A drag can start from a merely hovered node, so port drawing must not be
	// gated on the selection chrome. This is exactly what made them invisible.
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			selection: [],
			transform: null,
			ports: [{ x: 0, y: 0, radius: 4 }],
		},
		palette,
	);
	assert.equal(calls.filter((call) => call.op === "circle").length, 1);
});

test("the hovered port is drawn larger than the others", () => {
	// Without this the four ports are identical and there is no feedback about
	// which one a click will take.
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			ports: [
				{ x: 0, y: 0, radius: 4 },
				{ x: 40, y: 0, radius: 4 },
			],
			hoveredPort: { x: 40, y: 0 },
		},
		palette,
	);
	const radii = calls
		.filter((call) => call.op === "circle")
		.map((call) => call.args[2] as number);
	assert.equal(radii.length, 2);
	assert.ok(
		(radii[1] ?? 0) > (radii[0] ?? 0),
		`hovered port should be larger, got ${radii.join(" vs ")}`,
	);
});

test("a relation being dragged draws a line to the pointer", () => {
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			connectionDraft: {
				from: { x: 0, y: 0 },
				to: { x: 120, y: 60 },
				size: 2,
				targetFrame: null,
			},
		},
		palette,
	);
	const moves = calls.filter((call) => call.op === "moveTo");
	const lines = calls.filter((call) => call.op === "lineTo");
	assert.deepEqual(moves[0]?.args, [0, 0]);
	assert.deepEqual(lines[0]?.args, [120, 60]);
	// A dot marks the loose end, which a bare line does not communicate.
	assert.ok(calls.some((call) => call.op === "circle"));
});

test("the candidate target node is highlighted while dragging", () => {
	// Without a highlight there is no way to tell whether the drop will attach to
	// the node under the pointer or fall on empty canvas.
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			connectionDraft: {
				from: { x: 0, y: 0 },
				to: { x: 250, y: 50 },
				size: 2,
				targetFrame: frame,
			},
		},
		palette,
	);
	const rects = calls.filter((call) => call.op === "rect");
	assert.equal(rects.length, 1);
	assert.deepEqual(rects[0]?.args, [200, 0, 100, 100]);
});

test("no draft means no relation chrome", () => {
	const { scene, calls } = setup();
	scene.drawOverlay({ ...base }, palette);
	assert.equal(calls.filter((call) => call.op === "circle").length, 0);
	assert.equal(calls.filter((call) => call.op === "lineTo").length, 0);
});

test("stroke widths shrink with zoom so chrome stays constant on screen", () => {
	const { scene, calls } = setup();
	scene.drawOverlay(
		{
			...base,
			zoom: 4,
			connectionDraft: {
				from: { x: 0, y: 0 },
				to: { x: 10, y: 0 },
				size: 2,
				targetFrame: null,
			},
		},
		palette,
	);
	const stroke = calls.find((call) => call.op === "stroke");
	const width = (stroke?.args[0] as { width: number } | undefined)?.width ?? 0;
	assert.ok(width < 2, `expected a zoom-compensated width, got ${width}`);
});
