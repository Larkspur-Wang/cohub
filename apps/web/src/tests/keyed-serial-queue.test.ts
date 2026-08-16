import assert from "node:assert/strict";
import { test } from "node:test";
import { createKeyedSerialQueue } from "../lib/cache/keyed-serial-queue.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("serializes tasks sharing a key", async () => {
	const run = createKeyedSerialQueue();
	const gate = deferred();
	const started = deferred();
	const order: string[] = [];
	const first = run("session-1", async () => {
		order.push("first:start");
		started.resolve();
		await gate.promise;
		order.push("first:end");
	});
	const second = run("session-1", () => {
		order.push("second");
	});

	await started.promise;
	assert.deepEqual(order, ["first:start"]);
	gate.resolve();
	await Promise.all([first, second]);
	assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("runs different keys concurrently and continues after failure", async () => {
	const run = createKeyedSerialQueue();
	const gate = deferred();
	const blocked = run("session-1", () => gate.promise);
	let otherRan = false;
	await run("session-2", () => {
		otherRan = true;
	});
	assert.equal(otherRan, true);

	await assert.rejects(
		run("session-3", () => Promise.reject(new Error("failed"))),
	);
	const recovered = await run("session-3", () => "ok");
	assert.equal(recovered, "ok");
	gate.resolve();
	await blocked;
});
