import assert from "node:assert/strict";
import test from "node:test";
import { createCohubClient } from "../dist/index.js";

const response = {
	hourly: [],
	summary: {},
	days: 30,
	range: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-08T00:00:00.000Z" },
	rankings: null,
};

test("user usage serializes rolling and custom ranges", async () => {
	const calls: string[] = [];
	const client = createCohubClient({
		baseUrl: "https://api.example.com",
		getAccessToken: async () => "token",
		fetch: async (input) => {
			calls.push(String(input));
			return Response.json(response);
		},
	});

	await client.user.getUsage({ days: 7, rankings: true });
	await client.user.getUsage({
		from: new Date("2026-08-01T00:00:00.000Z"),
		to: "2026-08-08",
	});

	assert.deepEqual(calls, [
		"https://api.example.com/api/me/usage?days=7&rankings=1",
		"https://api.example.com/api/me/usage?from=2026-08-01T00%3A00%3A00.000Z&to=2026-08-08",
	]);
});
