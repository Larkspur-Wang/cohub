import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRunRecord } from "../src/types.js";
import {
	normalizeBoardTaskOutputUrl,
	taskRunToBoardTaskSnapshot,
} from "../src/board/task.js";

function taskRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
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
		result: null,
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
		...overrides,
	};
}

test("projects generation tasks to concise remote-media snapshots", () => {
	const snapshot = taskRunToBoardTaskSnapshot(
		taskRun({
			result: {
				output: [
					{ type: "image", source: { data: "large-base64" } },
					{
						type: "image",
						source: {
							url: "https://cdn.example.com/output.png",
							mediaType: "image/png",
							width: 1024,
							height: 1536,
						},
					},
				],
			},
		}),
	);

	assert.equal(snapshot.title, "A precise product sketch");
	assert.equal(snapshot.model, "image-model");
	assert.equal(snapshot.outputCount, 2);
	assert.deepEqual(snapshot.primaryOutput, {
		type: "image",
		url: "https://cdn.example.com/output.png",
		mimeType: "image/png",
		naturalWidth: 1024,
		naturalHeight: 1536,
	});
	assert.equal(JSON.stringify(snapshot).includes("large-base64"), false);
});

test("rejects local, inline, and credentialed task output URLs", () => {
	for (const url of [
		"data:video/mp4;base64,large",
		"blob:https://app.example.com/temporary",
		"file:///tmp/output.png",
		"https://user:secret@cdn.example.com/output.png",
		"http://localhost/output.png",
		"https://assets.local/output.png",
		"http://127.0.0.1/output.png",
		"http://2130706433/output.png",
		"http://10.0.0.8/output.png",
		"http://172.16.0.8/output.png",
		"http://192.168.0.8/output.png",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]/output.png",
		"http://[fc00::1]/output.png",
		"http://[fe80::1]/output.png",
		"http://[::ffff:127.0.0.1]/output.png",
		"http://[::127.0.0.1]/output.png",
		"http://[fec0::1]/output.png",
		"http://[2001:db8::1]/output.png",
	]) {
		assert.equal(normalizeBoardTaskOutputUrl(url), undefined);
	}
	assert.equal(
		normalizeBoardTaskOutputUrl("https://cdn.example.com/output.png"),
		"https://cdn.example.com/output.png",
	);
	assert.equal(
		normalizeBoardTaskOutputUrl("https://8.8.8.8/output.png"),
		"https://8.8.8.8/output.png",
	);
	assert.equal(
		normalizeBoardTaskOutputUrl("https://[2606:4700:4700::1111]/output.png"),
		"https://[2606:4700:4700::1111]/output.png",
	);
});

test("projects generic task facts without copying its payload", () => {
	const snapshot = taskRunToBoardTaskSnapshot(
		taskRun({
			taskType: "space_hook",
			status: "running",
			payload: { data: { command: "  Refresh the project index  ", secret: "private" } },
			result: { private: true },
		}),
	);

	assert.deepEqual(snapshot, {
		taskType: "space_hook",
		status: "running",
		title: "Refresh the project index",
		promptExcerpt: "Refresh the project index",
		outputCount: 0,
		updatedAt: "2026-08-14T10:00:02.000Z",
	});
	assert.equal(JSON.stringify(snapshot).includes("private"), false);
});
