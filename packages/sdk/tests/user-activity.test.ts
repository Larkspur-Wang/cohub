import assert from "node:assert/strict";
import test from "node:test";
import { createCohubClient } from "../dist/index.js";

const response = {
	hourly: [],
	summary: {},
	days: 30,
	range: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z" },
	rankings: { llmModels: [], generationModels: [], works: [] },
};

test("user activity serializes rolling and custom ranges", async () => {
	const calls: string[] = [];
	const client = createCohubClient({
		baseUrl: "https://api.example.com",
		getAccessToken: async () => "token",
		fetch: async (input) => {
			calls.push(String(input));
			return Response.json(response);
		},
	});

	await client.user.getActivity({ days: 7 });
	await client.user.getActivity({
		from: new Date("2026-08-01T00:00:00.000Z"),
		to: "2026-08-08",
	});

	assert.deepEqual(calls, [
		"https://api.example.com/api/me/activity?days=7",
		"https://api.example.com/api/me/activity?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-08",
	]);
});
