import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isCohubHostOrigin, WorkSurfaceApi } from "../src/work-surface.js";

/** A published Work is publicly embeddable, so these pin the trust boundary. */

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const COHUB = "https://cohub.run";

afterEach(() => {
	globalThis.window = originalWindow;
	globalThis.document = originalDocument;
});

function mountWork(embedder: string, self = "https://work.example") {
	const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
	let handler: ((event: MessageEvent) => void) | null = null;
	const parent = {
		postMessage: (message: Record<string, unknown>, origin: string) =>
			posted.push({ message, origin }),
	};
	globalThis.window = {
		parent,
		location: { origin: self, ancestorOrigins: [embedder] },
		addEventListener: (_t: "message", fn: (event: MessageEvent) => void) => {
			handler = fn;
		},
		removeEventListener: () => {
			handler = null;
		},
	} as unknown as Window & typeof globalThis;
	globalThis.document = { referrer: "" } as Document;

	const surface = new WorkSurfaceApi();
	const send = async (method: string, origin: string, source: unknown = parent) => {
		handler?.({
			data: { protocol: "cohub.surface", version: 1, type: "request", requestId: "r1", method },
			origin,
			source,
		} as MessageEvent);
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	return { surface, posted, send };
}

test("a Cohub host can call a method and gets a reply addressed to its origin", async () => {
	const { surface, posted, send } = mountWork(COHUB);
	surface.handle("ping", () => "pong");
	assert.deepEqual(
		{ origin: posted.at(-1)?.origin, type: posted.at(-1)?.message.type },
		{ origin: COHUB, type: "ready" },
	);

	await send("ping", COHUB);
	assert.deepEqual(posted.at(-1), {
		origin: COHUB,
		message: { protocol: "cohub.surface", version: 1, type: "response", requestId: "r1", ok: true, result: "pong" },
	});
});

// Each case must reach neither the handler nor `postMessage` — not even the
// method list may leak. `works.cohub.run` matters most: Works are served from
// there, so a suffix match would let one Work call into another.
for (const [name, embedder, origin, otherWindow] of [
	["a third-party embedder", "https://evil.example", "https://evil.example", false],
	["a spoofed origin from the real parent", COHUB, "https://evil.example", false],
	["another window claiming the host origin", COHUB, COHUB, true],
	["a Cohub content origin", "https://works.cohub.run", "https://works.cohub.run", false],
] as const) {
	test(`${name} cannot invoke a Work's methods`, async () => {
		const { surface, posted, send } = mountWork(embedder, "https://sessions.cohub.run");
		let calls = 0;
		surface.handle("ping", () => {
			calls += 1;
		});
		posted.length = 0;

		await send("ping", origin, otherWindow ? { postMessage() {} } : undefined);
		assert.equal(calls, 0);
		assert.equal(posted.length, 0);
	});
}

test("same-origin embedding stays trusted, since such a parent can already script us", async () => {
	const { surface, posted, send } = mountWork("http://localhost:5173", "http://localhost:5173");
	surface.handle("ping", () => "pong");
	await send("ping", "http://localhost:5173");

	assert.equal(posted.at(-1)?.message.ok, true);
	assert.equal(posted.at(-1)?.origin, "http://localhost:5173");
});

test("a self-hosted deployment can widen the allowlist", async () => {
	const { surface, posted, send } = mountWork("https://cohub.internal");
	surface.handle("ping", () => "pong");
	assert.equal(posted.length, 0, "not trusted by default");
	surface.allowHostOrigins(["https://cohub.internal"]);
	await send("ping", "https://cohub.internal");
	assert.equal(posted.at(-1)?.message.ok, true);
	assert.equal(posted.at(-1)?.origin, "https://cohub.internal");
});

test("an unknown method and a throwing handler both report instead of hanging", async () => {
	const { surface, posted, send } = mountWork(COHUB);
	surface.handle("boom", () => {
		throw new Error("nope");
	});

	await send("absent", COHUB);
	assert.deepEqual(posted.at(-1)?.message.error, {
		code: "method_not_found",
		message: 'This Work does not expose "absent".',
	});

	await send("boom", COHUB);
	assert.deepEqual(posted.at(-1)?.message.error, { code: "handler_failed", message: "nope" });
});

// Otherwise the host forwards nothing, or the later upload fails, and the caller
// only ever sees a timeout for a method that actually ran.
for (const [name, value, code] of [
	["a cyclic object", (() => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		return cyclic;
	})(), "result_not_serializable"],
	["a function", () => "nope", "result_not_serializable"],
	["an oversized string", "x".repeat(33 * 1024), "result_too_large"],
] as const) {
	test(`${name} returned by a handler is rejected as ${code}`, async () => {
		const { surface, posted, send } = mountWork(COHUB);
		surface.handle("give", () => value);

		await send("give", COHUB);
		const reply = posted.at(-1)?.message;
		assert.equal(reply?.ok, false);
		const error = reply?.error as { code: string } | undefined;
		assert.equal(error?.code, code);
	});
}

test("only explicit app origins are trusted, not the whole subdomain space", () => {
	for (const origin of [COHUB, "https://dev.cohub.run"]) {
		assert.equal(isCohubHostOrigin(origin), true, origin);
	}
	for (const origin of [
		"https://works.cohub.run",
		"https://public.cohub.run",
		"https://anything.cohub.run",
		"http://cohub.run",
		"https://cohub.run.evil.example",
		"https://notcohub.run",
		"garbage",
	]) {
		assert.equal(isCohubHostOrigin(origin), false, origin);
	}
});
