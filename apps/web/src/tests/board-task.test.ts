import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRunRecord } from "@neta-art/cohub";
import {
	BoardDocumentSchema,
	boardNodeToItem,
	imageAssetKey,
	taskRunToBoardTaskSnapshot as taskBoardSnapshot,
} from "@neta-art/cohub/board";
import {
	boardItemToNode,
	createEmptyBoardDocument,
} from "$lib/board/board-document";
import { createTaskBoardItem } from "$lib/board/board-items";

function generationRun(result: unknown): TaskRunRecord {
	return {
		id: "task_1",
		jobId: "job_1",
		cronJobId: null,
		taskType: "generation",
		status: "completed",
		payload: {
			type: "generation",
			data: {
				model: "image-model",
				content: [{ type: "text", text: "  A precise product sketch  " }],
			},
		},
		result,
		errorMessage: null,
		attemptCount: 1,
		spaceId: "space_1",
		sessionId: null,
		turnId: null,
		userUuid: null,
		scheduledAt: null,
		startedAt: null,
		finishedAt: "2026-08-14T10:00:02.000Z",
		createdAt: "2026-08-14T10:00:00.000Z",
		updatedAt: "2026-08-14T10:00:02.000Z",
	};
}

test("projects a generation task to a concise remote-media snapshot", () => {
	const snapshot = taskBoardSnapshot(
		generationRun({
			output: [
				{ type: "image", source: { data: "large-base64" } },
				{
					type: "image",
					source: {
						url: "https://cdn.example.com/output.png",
						width: 1024,
						height: 1536,
					},
				},
			],
		}),
	);

	assert.equal(snapshot.title, "A precise product sketch");
	assert.equal(snapshot.model, "image-model");
	assert.deepEqual(snapshot.artifacts, [
		{
			id: "output-2",
			type: "image",
			url: "https://cdn.example.com/output.png",
			naturalWidth: 1024,
			naturalHeight: 1536,
		},
	]);
	assert.equal(JSON.stringify(snapshot).includes("large-base64"), false);
});

test("never persists inline generation media in a task snapshot", () => {
	const snapshot = taskBoardSnapshot(
		generationRun({
			output: [
				{ type: "video", src: "data:video/mp4;base64,large" },
				{ type: "image", src: "blob:https://app.example.com/temporary" },
			],
		}),
	);

	assert.deepEqual(snapshot.artifacts, []);
});

test("task items survive document and server-node round trips", () => {
	const snapshot = taskBoardSnapshot(
		generationRun({
			output: [
				{
					type: "image",
					url: "https://cdn.example.com/output.png",
					width: 1024,
					height: 1536,
				},
			],
		}),
	);
	const item = createTaskBoardItem("task_1", snapshot, 200, 120);
	const document = BoardDocumentSchema.parse({
		...createEmptyBoardDocument(),
		items: [item],
	});
	const node = boardItemToNode(document.items[0], 0, 1);
	const decoded = boardNodeToItem({
		...node,
		boardId: "board_1",
		version: 1,
		createdAt: null,
		updatedAt: null,
	});

	assert.equal(decoded.type, "task");
	if (decoded.type !== "task") assert.fail("expected task item");
	assert.equal(decoded.taskRunId, "task_1");
	assert.deepEqual(decoded.snapshot, snapshot);
	assert.equal(
		imageAssetKey(decoded),
		"url:https://cdn.example.com/output.png",
	);
	assert.ok(
		Math.abs(decoded.frame.width / decoded.frame.height - 2 / 3) < 1e-6,
	);
});
