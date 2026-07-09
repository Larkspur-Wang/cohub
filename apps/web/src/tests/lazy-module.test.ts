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
