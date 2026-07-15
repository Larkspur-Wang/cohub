import assert from "node:assert/strict";
import { test } from "node:test";
import { createLazyModuleLoader } from "../lib/lazy-module.ts";

test("createLazyModuleLoader retries a transient load failure and caches success", async () => {
	let calls = 0;
	const loadedModule = { default: "module" };
	const loadModule = createLazyModuleLoader(async () => {
		calls += 1;
		if (calls === 1) throw new Error("transient import failure");
		return loadedModule;
	}, 1);

	assert.equal(await loadModule(), loadedModule);
	assert.equal(await loadModule(), loadedModule);
	assert.equal(calls, 2);
});

test("createLazyModuleLoader clears failed loads so the next call can recover", async () => {
	let calls = 0;
	const loadModule = createLazyModuleLoader(async () => {
		calls += 1;
		if (calls === 1) throw new Error("import failed");
		return "module";
	}, 0);

	await assert.rejects(loadModule(), /import failed/);
	assert.equal(await loadModule(), "module");
	assert.equal(calls, 2);
});

test("createLazyModuleLoader retries with multi-step backoff before failing", async () => {
	let calls = 0;
	const loadModule = createLazyModuleLoader(async () => {
		calls += 1;
		throw new Error("still failing");
	}, [1, 1]);

	await assert.rejects(loadModule(), /still failing/);
	assert.equal(calls, 3);
});

test("createLazyModuleLoader recovers after multi-step failure on next call", async () => {
	let calls = 0;
	const loadModule = createLazyModuleLoader(async () => {
		calls += 1;
		if (calls <= 3) throw new Error("warming up");
		return "ready";
	}, [1, 1]);

	await assert.rejects(loadModule(), /warming up/);
	assert.equal(calls, 3);
	assert.equal(await loadModule(), "ready");
	assert.equal(calls, 4);
});
