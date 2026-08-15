import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BOARD_NODE_CONTRACT,
	validateBoardNodeInput,
} from "./src/board-node.js";
import {
	BOARD_REMOTE_URL_MAX_LENGTH,
	BOARD_TASK_ARTIFACT_LIMIT,
	BoardTaskSnapshotSchema,
} from "./src/board-document.js";

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

test("rejects unsafe task artifact URLs at the node boundary", () => {
	for (const url of [
		"data:image/png;base64,a",
		"javascript:alert(1)",
		"file:///tmp/private.mp3",
		"https://user:secret@cdn.example/output.mp3",
		"http://localhost/output.mp3",
		"http://127.0.0.1/output.mp3",
		"http://10.0.0.8/output.mp3",
		"http://[::1]/output.mp3",
	]) {
		const diagnostics = validateBoardNodeInput({
			...base,
			type: "task",
			view: {
				taskType: "generation",
				status: "completed",
				title: "Unsafe output",
				artifactCount: 1,
				artifacts: [{ id: "output", type: "audio", url }],
			},
			data: { taskRunId: "task_1" },
		});
		assert.equal(diagnostics[0]?.path, "node.view.artifacts.0.url");
	}

	assert.deepEqual(
		validateBoardNodeInput({
			...base,
			type: "task",
			view: {
				taskType: "generation",
				status: "completed",
				title: "Public output",
				artifactCount: 1,
				artifacts: [
					{
						id: "output",
						type: "audio",
						url: "https://cdn.example/output.mp3",
					},
				],
			},
			data: { taskRunId: "task_1" },
		}),
		[],
	);
});

test("bounds task artifacts below the server JSON field limit", () => {
	const prefix = "https://cdn.example/";
	const url = prefix + "a".repeat(BOARD_REMOTE_URL_MAX_LENGTH - prefix.length);
	const artifact = {
		id: "i".repeat(240),
		type: "video" as const,
		title: "t".repeat(240),
		url,
		previewUrl: url,
		mimeType: "m".repeat(160),
		durationMs: 1,
	};
	const snapshot = BoardTaskSnapshotSchema.parse({
		taskType: "generation",
		status: "completed",
		title: "Bounded",
		artifactCount: BOARD_TASK_ARTIFACT_LIMIT,
		artifacts: Array.from(
			{ length: BOARD_TASK_ARTIFACT_LIMIT },
			(_, index) => ({ ...artifact, id: `${index}-${artifact.id}`.slice(0, 240) }),
		),
	});

	assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength < 64 * 1024);
	assert.equal(
		BoardTaskSnapshotSchema.safeParse({
			...snapshot,
			artifactCount: BOARD_TASK_ARTIFACT_LIMIT + 1,
			artifacts: [...snapshot.artifacts, artifact],
		}).success,
		false,
	);
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
