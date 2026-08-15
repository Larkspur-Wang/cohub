import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOARD_NODE_CONTRACT,
	validateBoardNodeInput,
} from "./src/board-node.js";

const base = {
	nodeId: "n1",
	type: "text",
	parentId: null,
	orderKey: null,
	x: 0,
	y: 0,
	width: 100,
	height: 40,
	rotation: 0,
	refKind: null,
	refPath: null,
	refUrl: null,
	view: {},
	style: {},
	data: { text: "Hello", color: "neutral", fontSize: 24 },
};

test("publishes a compact machine-readable node contract", () => {
	assert.ok(BOARD_NODE_CONTRACT.types.includes("draw"));
	assert.ok(BOARD_NODE_CONTRACT.colors.includes("rose"));
	assert.equal(BOARD_NODE_CONTRACT.coordinates.drawPoints, "frame-local");
	assert.equal(BOARD_NODE_CONTRACT.coordinates.arrowEndpoints, "world");
	assert.equal(BOARD_NODE_CONTRACT.references.kind, "space_file");
	const geoSchema = BOARD_NODE_CONTRACT.schemas.data.geo as {
		properties?: { geo?: { default?: unknown } };
	};
	assert.equal(geoSchema.properties?.geo?.default, "rectangle");
});

test("rejects unknown types and raw colors with stable paths", () => {
	const unknown = validateBoardNodeInput({ ...base, type: "rect" }, "nodes.0");
	assert.equal(unknown[0]?.code, "INVALID_BOARD_NODE");
	assert.equal(unknown[0]?.path, "nodes.0.type");
	assert.deepEqual(unknown[0]?.allowedValues, BOARD_NODE_CONTRACT.types);

	const color = validateBoardNodeInput({
		...base,
		data: { text: "Hello", color: "#22c55e", fontSize: 24 },
	}, "nodes.1");
	assert.equal(color[0]?.path, "nodes.1.data.color");
});

test("requires draw samples to match their local frame", () => {
	const diagnostics = validateBoardNodeInput({
		...base,
		type: "draw",
		x: 100,
		y: 200,
		width: 44,
		height: 44,
		data: {
			points: [
				{ x: 100, y: 200, p: 0.5 },
				{ x: 140, y: 240, p: 0.5 },
			],
			color: "brand",
			size: 4,
		},
	}, "nodes.0");
	assert.equal(diagnostics[0]?.code, "INVALID_BOARD_GEOMETRY");
	assert.equal(diagnostics[0]?.coordinateSpace, "frame-local");
});
