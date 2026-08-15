import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BoardInputError,
	createBoardNode,
	validateBoardNodes,
} from "../../src/board/nodes.js";

const frame = { x: 10, y: 20, width: 200, height: 100 };

test("createBoardNode is the single semantic builder for native nodes", () => {
	const geo = createBoardNode({
		id: "geo-1",
		type: "geo",
		frame,
		geo: "ellipse",
		color: "green",
	});
	assert.equal(geo.type, "geo");
	assert.deepEqual(geo.data, {
		geo: "ellipse",
		text: "",
		color: "green",
		fillOpacity: 0,
	});
});

test("draw input uses world samples and stores frame-local points", () => {
	const draw = createBoardNode({
		id: "draw-1",
		type: "draw",
		points: [
			{ x: 100, y: 100, p: 0.5 },
			{ x: 150, y: 120, p: 0.5 },
		],
		color: "rose",
		size: 4,
	});
	const points = draw.data.points as Array<{ x: number; y: number }>;
	assert.ok(draw.x < 100);
	assert.ok((points[0]?.x ?? Infinity) < 10);
	assert.deepEqual(validateBoardNodes([draw]), []);
});

test("arrow input uses world endpoints and derives its frame", () => {
	const arrow = createBoardNode({
		id: "arrow-1",
		type: "arrow",
		start: { x: 50, y: 80 },
		end: { x: 250, y: 180 },
		arrowEnd: false,
	});
	assert.deepEqual(arrow.data.start, { x: 50, y: 80 });
	assert.equal(arrow.x, 34);
	assert.equal(arrow.width, 232);
	assert.deepEqual(validateBoardNodes([arrow]), []);
});

test("invalid raw nodes fail with machine-readable diagnostics", () => {
	assert.throws(
		() => createBoardNode({
			id: "text-1",
			type: "text",
			frame,
			color: "#fff" as "brand",
		}),
		(error) =>
			error instanceof BoardInputError &&
			error.body.diagnostics[0]?.path === "nodes.0.data.color",
	);
});
