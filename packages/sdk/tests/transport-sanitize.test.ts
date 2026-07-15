import assert from "node:assert/strict";
import { test } from "node:test";
// Import built package so node:test can run without a TS loader.
import {
	HttpError,
	joinApiUrl,
	sanitizeAccessToken,
	createCohubClient,
} from "../dist/index.js";

test("sanitizeAccessToken strips CR/LF/TAB and empty results", () => {
	assert.equal(sanitizeAccessToken("  abc.def  "), "abc.def");
	assert.equal(sanitizeAccessToken("abc\r\ndef"), "abcdef");
	assert.equal(sanitizeAccessToken("tok\ten"), "token");
	assert.equal(sanitizeAccessToken("\n\r\t"), null);
	assert.equal(sanitizeAccessToken(""), null);
	assert.equal(sanitizeAccessToken(null), null);
	assert.equal(sanitizeAccessToken(undefined), null);
});

test("joinApiUrl joins absolute base and path without double slash", () => {
	assert.equal(
		joinApiUrl("https://api.cohub.run", "/api/spaces/x/prompt"),
		"https://api.cohub.run/api/spaces/x/prompt",
	);
	assert.equal(
		joinApiUrl("https://api.cohub.run/", "/api/spaces/x/prompt"),
		"https://api.cohub.run/api/spaces/x/prompt",
	);
	assert.equal(
		joinApiUrl("https://api.cohub.run", "api/spaces/x/prompt"),
		"https://api.cohub.run/api/spaces/x/prompt",
	);
	assert.equal(joinApiUrl("", "/api/spaces"), "/api/spaces");
	assert.equal(joinApiUrl("  ", "/api/spaces"), "/api/spaces");
});

test("HttpTransport Authorization header uses sanitized tokens", async () => {
	const calls = [];
	const client = createCohubClient({
		baseUrl: "https://api.example.com",
		getAccessToken: async () => "good.token\r\n",
		fetch: async (input, init) => {
			const headers = new Headers(init?.headers);
			calls.push({
				url: String(input),
				auth: headers.get("Authorization"),
			});
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		},
	});
	await client.spaces.list();
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.auth, "Bearer good.token");
	assert.equal(calls[0]?.url, "https://api.example.com/api/spaces");
	assert.ok(HttpError);
});

test("HttpTransport can skip onUnauthorized for bootstrap 401s", async () => {
	let unauthorizedCalls = 0;
	const client = createCohubClient({
		baseUrl: "https://api.example.com",
		getAccessToken: async () => "token",
		onUnauthorized: () => {
			unauthorizedCalls += 1;
		},
		fetch: async () =>
			new Response(JSON.stringify({ message: "unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			}),
	});

	await assert.rejects(
		() => client.user.getMe({ skipUnauthorizedHandler: true }),
		(error: unknown) => error instanceof HttpError && error.status === 401,
	);
	assert.equal(unauthorizedCalls, 0);

	await assert.rejects(
		() => client.user.getMe(),
		(error: unknown) => error instanceof HttpError && error.status === 401,
	);
	assert.equal(unauthorizedCalls, 1);
});
