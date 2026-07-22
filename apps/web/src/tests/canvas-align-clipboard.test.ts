import assert from "node:assert/strict";
import { test } from "node:test";
import { resizeFrame, worldPoint } from "../lib/canvas/canvas-geometry.ts";
import { createNoteCanvasItem } from "../lib/canvas/canvas-items.ts";
import {
	textResolutionForZoom,
	textZoomBucket,
} from "../lib/canvas/canvas-rendering.ts";
import type { CanvasFrame } from "../lib/canvas/canvas-schema.ts";
import { createSpatialIndex } from "../lib/canvas/canvas-spatial.ts";
import { alignFrames, distributeFrames } from "../lib/canvas/core/align.ts";
import {
	encodeClipboard,
	materializeClipboard,
	parseClipboard,
} from "../lib/canvas/core/clipboard.ts";
import { itemsToSvg } from "../lib/canvas/core/export-svg.ts";

const frame = (x: number, y: number, w = 100, h = 80): CanvasFrame => ({
	x,
	y,
	width: w,
	height: h,
	rotation: 0,
});

test("alignFrames left / center-x / right", () => {
	const frames = new Map<string, CanvasFrame>([
		["a", frame(0, 0, 100, 50)],
		["b", frame(200, 10, 50, 50)],
	]);
	const left = alignFrames(frames, "left");
	assert.equal(left.get("b")?.x, 0);

	const right = alignFrames(frames, "right");
	assert.equal(right.get("a")?.x, 150); // 250 - 100

	const cx = alignFrames(frames, "center-x");
	// selection bounds: x0..250, center 125; a center should land on 125 → x=75
	assert.equal(cx.get("a")?.x, 75);
});

test("distributeFrames horizontal spaces evenly", () => {
	const frames = new Map<string, CanvasFrame>([
		["a", frame(0, 0, 20, 20)],
		["b", frame(40, 0, 20, 20)],
		["c", frame(200, 0, 20, 20)],
	]);
	const next = distributeFrames(frames, "horizontal");
	// a and c stay outermost; b moves to midpoint of free space.
	// total span 0..220, sizes 60, gap = (220-60)/2 = 80
	// positions: 0, 100, 200
	assert.equal(next.get("b")?.x, 100);
	assert.equal(next.has("a"), false); // unchanged outermost
	assert.equal(next.has("c"), false);
});

test("clipboard round-trip remaps ids and offsets", () => {
	const a = createNoteCanvasItem(10, 20, "brand", "hello");
	const b = createNoteCanvasItem(50, 60, "blue", "world");
	const payload = encodeClipboard([a, b]);
	assert.ok(payload);
	// Origin is the top-left of the selection AABB (notes are centered on creation).
	assert.equal(payload?.origin.x, a.frame.x);
	assert.equal(payload?.origin.y, a.frame.y);

	const parsed = parseClipboard(payload);
	assert.ok(parsed);
	if (!parsed) return;
	const items = materializeClipboard(parsed, { x: 100, y: 100 });
	assert.equal(items.length, 2);
	assert.notEqual(items[0]?.id, a.id);
	assert.equal(items[0]?.frame.x, 100); // relative 0 + 100
	const dx = b.frame.x - a.frame.x;
	assert.equal(items[1]?.frame.x, 100 + dx);
});

test("parseClipboard rejects duplicate ids and malformed entries", () => {
	const note = createNoteCanvasItem(0, 0, "brand", "ok");
	assert.equal(
		parseClipboard({
			kind: "cohub.canvas.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [note, { ...note }], // same id twice
		}),
		null,
	);
	assert.equal(
		parseClipboard({
			kind: "cohub.canvas.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [null, note],
		}),
		null,
	);
	assert.equal(
		parseClipboard({
			kind: "cohub.canvas.clipboard",
			version: 1,
			origin: { x: 0, y: 0 },
			items: [{ id: "r1", type: "image" }], // malformed known type
		}),
		null,
	);
});

test("itemsToSvg emits an svg document for notes", () => {
	const note = createNoteCanvasItem(0, 0, "brand", "Hi");
	const svg = itemsToSvg([note], () => undefined);
	assert.match(svg, /^<\?xml/);
	assert.match(svg, /<svg /);
	assert.match(svg, /Hi/);
});

test("textZoomBucket quantises zoom for re-rasterisation", () => {
	assert.equal(textZoomBucket(0.4), 0.5);
	assert.equal(textZoomBucket(1.2), 1.5);
	assert.equal(textZoomBucket(2.5), 3);
	assert.ok(textResolutionForZoom(2) >= textResolutionForZoom(1));
});

test("spatial index upsert updates a dirty entry without full rebuild", () => {
	const index = createSpatialIndex();
	index.rebuild([
		{ id: "a", order: 0, rect: { x: 0, y: 0, width: 10, height: 10 } },
		{ id: "b", order: 1, rect: { x: 100, y: 100, width: 10, height: 10 } },
	]);
	assert.deepEqual(index.idsAtPoint({ x: 5, y: 5 }), ["a"]);

	index.upsert(
		new Map([
			[
				"a",
				{ id: "a", order: 0, rect: { x: 50, y: 50, width: 10, height: 10 } },
			],
		]),
	);
	assert.deepEqual(index.idsAtPoint({ x: 5, y: 5 }), []);
	assert.deepEqual(index.idsAtPoint({ x: 55, y: 55 }), ["a"]);
});

test("resizeFrame keepAspect preserves ratio on corner drag", () => {
	const start = frame(0, 0, 100, 50);
	const next = resizeFrame(start, "se", worldPoint(200, 200), 24, true);
	assert.ok(Math.abs(next.width / next.height - 2) < 1e-6);
});
