import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoardAssetManager } from "../lib/board/board-asset-manager.ts";
import type { BoardItem } from "../lib/board/board-schema.ts";

type FakeTexture = { width: number; height: number; destroyed: boolean };

function imageItem(id: string, path: string): BoardItem {
	return {
		id,
		type: "image",
		ref: { kind: "space-file", path },
		snapshot: { mimeType: "image/png" },
		frame: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
	};
}

/** Build a manager backed by fake textures, a controllable clock, and load/unload spies. */
function harness(budget: { maxCount: number; maxBytes: number }) {
	let clock = 0;
	const loaded: string[] = [];
	const unloaded: string[] = [];
	const textures = new Map<string, FakeTexture>();
	const manager = createBoardAssetManager({
		spaceId: "space",
		now: () => clock,
		lruBudget: budget,
		resolveSpaceFileUrl: async (_spaceId, path) => path,
		loadTexture: async (url) => {
			loaded.push(url);
			const texture: FakeTexture = { width: 10, height: 10, destroyed: false };
			textures.set(url, texture);
			return texture as never;
		},
		unloadTexture: (url) => {
			unloaded.push(url);
			const texture = textures.get(url);
			if (texture) texture.destroyed = true;
			return Promise.resolve();
		},
	});
	return {
		manager,
		loaded,
		unloaded,
		textures,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("released texture stays in the cooling pool until the budget is exceeded", async () => {
	const { manager, loaded, unloaded, advance } = harness({
		maxCount: 2,
		maxBytes: Number.POSITIVE_INFINITY,
	});

	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	advance(1);
	manager.acquire("file:b");
	manager.requestItem(imageItem("b", "b"));
	await flush();

	assert.equal(loaded.length, 2);
	assert.ok(manager.getTexture("file:a"));
	assert.ok(manager.getTexture("file:b"));

	// Release both: they cool (refs 0) but the pool (2) fits the budget (2).
	manager.release("file:a");
	manager.release("file:b");
	assert.equal(unloaded.length, 0, "nothing evicted while within budget");
	assert.ok(manager.getTexture("file:a"), "cooled texture still on the GPU");

	// A third image pushes the pool over budget → the oldest (a) is evicted.
	advance(1);
	manager.acquire("file:c");
	manager.requestItem(imageItem("c", "c"));
	await flush();
	manager.release("file:c");
	assert.deepEqual(unloaded, ["a"], "LRU entry evicted first");
	assert.equal(manager.getTexture("file:a"), null);
	assert.ok(manager.getTexture("file:b"));
});

test("re-acquiring a cooled texture avoids a reload", async () => {
	const { manager, loaded } = harness({
		maxCount: 8,
		maxBytes: Number.POSITIVE_INFINITY,
	});
	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	await flush();
	assert.equal(loaded.length, 1);

	manager.release("file:a");
	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	await flush();
	assert.equal(loaded.length, 1, "no second load for a cooled texture");
	assert.ok(manager.getTexture("file:a"));
});

test("an evicted texture reloads on next request", async () => {
	const { manager, loaded, advance } = harness({
		maxCount: 1,
		maxBytes: Number.POSITIVE_INFINITY,
	});
	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	advance(1);
	manager.acquire("file:b");
	manager.requestItem(imageItem("b", "b"));
	await flush();
	manager.release("file:a");
	manager.release("file:b");
	// Pool over budget (maxCount 1): oldest (a) evicted.
	assert.equal(manager.getTexture("file:a"), null);

	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	await flush();
	assert.equal(loaded.filter((url) => url === "a").length, 2, "a reloaded");
	assert.ok(manager.getTexture("file:a"));
});

test("a load that settles after its card is culled cools instead of leaking", async () => {
	const { manager, unloaded } = harness({
		maxCount: 8,
		maxBytes: Number.POSITIVE_INFINITY,
	});
	// Request without acquiring (card culled mid-load), then let it settle.
	manager.requestItem(imageItem("a", "a"));
	await flush();
	// refs 0 but loaded: should be kept cooling, not unloaded.
	assert.equal(unloaded.length, 0);
	assert.ok(manager.getTexture("file:a"));
});

test("re-requesting an evicted URL waits for the in-flight unload (no blank texture)", async () => {
	let clock = 0;
	const loaded: string[] = [];
	const unloaded: string[] = [];
	const textures = new Map<string, FakeTexture>();
	const pending: Array<() => void> = [];
	const manager = createBoardAssetManager({
		spaceId: "space",
		now: () => clock,
		lruBudget: { maxCount: 1, maxBytes: Number.POSITIVE_INFINITY },
		resolveSpaceFileUrl: async (_spaceId, path) => path,
		loadTexture: async (url) => {
			loaded.push(url);
			const texture: FakeTexture = {
				width: 10,
				height: 10,
				destroyed: false,
			};
			textures.set(`${url}#${loaded.length}`, texture);
			return texture as never;
		},
		// Async unload: the texture is only destroyed when the caller resolves it,
		// modelling a real Assets.unload that completes on a later tick.
		unloadTexture: (url) => {
			unloaded.push(url);
			return new Promise<void>((resolve) => {
				pending.push(() => {
					const texture = textures.get(`${url}#1`);
					if (texture) texture.destroyed = true;
					resolve();
				});
			});
		},
	});

	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	clock += 1;
	manager.acquire("file:b");
	manager.requestItem(imageItem("b", "b"));
	await flush();
	manager.release("file:a");
	manager.release("file:b"); // pool over budget → evicts oldest (a), unload pending
	assert.equal(unloaded.length, 1);
	assert.equal(manager.getTexture("file:a"), null);

	// Pan back before the unload settles: the reload must wait for it.
	manager.acquire("file:a");
	manager.requestItem(imageItem("a", "a"));
	await flush();
	assert.equal(
		loaded.filter((u) => u === "a").length,
		1,
		"reload is held until the pending unload settles",
	);

	for (const resolve of pending.splice(0)) resolve();
	await flush();
	await flush();
	assert.equal(
		loaded.filter((u) => u === "a").length,
		2,
		"reloaded after unload",
	);
	const reloaded = manager.getTexture("file:a");
	assert.ok(reloaded);
	assert.equal(
		(reloaded as unknown as FakeTexture).destroyed,
		false,
		"the displayed texture is a fresh one, not the destroyed original",
	);
});
