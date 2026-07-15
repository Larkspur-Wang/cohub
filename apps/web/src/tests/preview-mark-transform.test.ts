import assert from "node:assert/strict";
import { test } from "node:test";
import { strokesAfterCrop } from "../lib/features/preview-mark/mark/transform";
import type { Stroke } from "../lib/features/preview-mark/types";

test("strokesAfterCrop offsets pen points into crop-local space", () => {
	const strokes: Stroke[] = [
		{
			id: "p1",
			tool: "pen",
			color: "brand",
			points: [
				{ x: 50, y: 60 },
				{ x: 80, y: 90 },
			],
			width: 3,
		},
	];
	const next = strokesAfterCrop(strokes, {
		x: 40,
		y: 50,
		width: 100,
		height: 100,
	});
	assert.equal(next.length, 1);
	assert.equal(next[0].tool, "pen");
	if (next[0].tool !== "pen") return;
	assert.deepEqual(next[0].points, [
		{ x: 10, y: 10 },
		{ x: 40, y: 40 },
	]);
});

test("strokesAfterCrop drops marks fully outside the crop", () => {
	const strokes: Stroke[] = [
		{
			id: "a1",
			tool: "arrow",
			color: "red",
			from: { x: 10, y: 10 },
			to: { x: 20, y: 20 },
			width: 2,
		},
		{
			id: "r1",
			tool: "rect",
			color: "yellow",
			a: { x: 120, y: 120 },
			b: { x: 180, y: 180 },
			width: 2,
		},
	];
	const next = strokesAfterCrop(strokes, {
		x: 100,
		y: 100,
		width: 100,
		height: 100,
	});
	assert.equal(next.length, 1);
	assert.equal(next[0].id, "r1");
	if (next[0].tool !== "rect") return;
	assert.deepEqual(next[0].a, { x: 20, y: 20 });
	assert.deepEqual(next[0].b, { x: 80, y: 80 });
});

test("strokesAfterCrop keeps partially intersecting strokes", () => {
	const strokes: Stroke[] = [
		{
			id: "p2",
			tool: "pen",
			color: "white",
			points: [
				{ x: 5, y: 50 },
				{ x: 60, y: 50 },
			],
			width: 2,
		},
	];
	const next = strokesAfterCrop(strokes, {
		x: 40,
		y: 0,
		width: 80,
		height: 100,
	});
	assert.equal(next.length, 1);
	if (next[0].tool !== "pen") return;
	assert.deepEqual(next[0].points, [
		{ x: -35, y: 50 },
		{ x: 20, y: 50 },
	]);
});
