import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkSurfaceHost } from "../lib/features/work/surface-host.ts";

const ORIGIN = "https://cohub.run";

/** A call awaits readiness before posting. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function mountHost(options: { frameOrigin?: string | null } = {}) {
	const posted: Array<{ message: Record<string, unknown>; origin: string }> =
		[];
	const contentWindow = {
		postMessage: (message: Record<string, unknown>, origin: string) =>
			posted.push({ message, origin }),
	};
	const host = createWorkSurfaceHost({
		getFrame: () => ({ contentWindow }) as unknown as HTMLIFrameElement,
		getFrameOrigin: () =>
			options.frameOrigin === undefined ? ORIGIN : options.frameOrigin,
	});

	const event = (
		type: string,
		extra: Record<string, unknown>,
		source: unknown = contentWindow,
		origin = ORIGIN,
	) =>
		({
			source,
			origin,
			data: { protocol: "cohub.surface", version: 1, type, ...extra },
		}) as MessageEvent;

	return {
		host,
		posted,
		contentWindow,
		ready: (methods: string[], source?: unknown, origin?: string) =>
			host.handleMessage(event("ready", { methods }, source, origin)),
		respond: (
			payload: Record<string, unknown>,
			source?: unknown,
			origin?: string,
		) => host.handleMessage(event("response", payload, source, origin)),
	};
}

test("a call resolves with the result the Work returned", async () => {
	const { host, posted, ready, respond } = mountHost();
	ready(["selection.get"]);
	assert.equal(host.ready, true);
	assert.deepEqual(host.methods, ["selection.get"]);

	const pending = host.call({
		method: "selection.get",
		input: { scope: "active" },
	});
	await flush();
	assert.equal(posted.at(-1)?.origin, ORIGIN);
	assert.equal(posted.at(-1)?.message.method, "selection.get");

	respond({
		requestId: posted.at(-1)?.message.requestId,
		ok: true,
		result: { nodes: 2 },
	});
	assert.deepEqual(await pending, { ok: true, result: { nodes: 2 } });
});

test("messages from another origin or window cannot answer for the surface", async () => {
	const { host, posted, contentWindow, ready, respond } = mountHost();
	ready(["ping"]);

	assert.equal(ready(["ping"], contentWindow, "https://evil.example"), false);
	assert.equal(ready(["ping"], {}), false);

	const pending = host.call({ method: "ping", requestTimeoutMs: 40 });
	await flush();
	const requestId = posted.at(-1)?.message.requestId;
	respond(
		{ requestId, ok: true, result: "spoofed" },
		contentWindow,
		"https://evil.example",
	);
	respond({ requestId, ok: true, result: "spoofed" }, {});

	const result = await pending;
	assert.equal(result.ok === false && result.code, "surface_timeout");
});

test("an unannounced method fails fast instead of hanging", async () => {
	const { host, ready } = mountHost();
	ready(["selection.get"]);

	const result = await host.call({ method: "nope" });
	assert.equal(result.ok === false && result.code, "method_not_found");
});

test("a Work that never registers methods reports not-ready", async () => {
	const { host } = mountHost();
	const result = await host.call({ method: "ping", readyTimeoutMs: 30 });
	assert.equal(result.ok === false && result.code, "surface_not_ready");
});

test("an untrusted frame origin is never posted to", async () => {
	const { host, posted } = mountHost({ frameOrigin: null });

	const result = await host.call({ method: "ping" });
	assert.equal(result.ok === false && result.code, "surface_unavailable");
	assert.equal(posted.length, 0);
});

// A reload must not leave a caller stuck on its timer, in flight or not yet ready.
for (const [name, announce] of [
	["in flight", true],
	["still waiting for readiness", false],
] as const) {
	test(`reset promptly settles a call ${name}`, async () => {
		const { host, ready } = mountHost();
		if (announce) ready(["ping"]);

		const pending = host.call({
			method: "ping",
			readyTimeoutMs: 10_000,
			requestTimeoutMs: 10_000,
		});
		await flush();
		const startedAt = Date.now();
		host.reset();

		const result = await pending;
		assert.equal(result.ok === false && result.code, "surface_reset");
		assert.ok(Date.now() - startedAt < 500, "reset should settle promptly");
		assert.equal(host.ready, false);
	});
}
