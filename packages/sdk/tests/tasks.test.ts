import assert from "node:assert/strict";
import test from "node:test";
import { TasksApi } from "../src/apis/tasks.js";
import type { HttpTransport } from "../src/transport.js";

test("getMany deduplicates task IDs and scopes the batch to a Space", async () => {
	const requests: string[] = [];
	const transport = {
		request(path: string) {
			requests.push(path);
			return Promise.resolve({ runs: [] });
		},
	} as unknown as HttpTransport;
	const tasks = new TasksApi(transport);

	await tasks.getMany(["task-1", "task-2", "task-1"], {
		spaceId: "space-1",
	});

	assert.equal(requests.length, 1);
	const url = new URL(requests[0] ?? "", "https://api.example.com");
	assert.equal(url.pathname, "/api/tasks");
	assert.equal(url.searchParams.get("ids"), "task-1,task-2");
	assert.equal(url.searchParams.get("spaceId"), "space-1");
	assert.equal(url.searchParams.get("limit"), "2");
});

test("getMany avoids a request for an empty batch", async () => {
	let requested = false;
	const transport = {
		request() {
			requested = true;
			return Promise.resolve({ runs: [] });
		},
	} as unknown as HttpTransport;

	const result = await new TasksApi(transport).getMany([]);

	assert.deepEqual(result, { runs: [] });
	assert.equal(requested, false);
});
