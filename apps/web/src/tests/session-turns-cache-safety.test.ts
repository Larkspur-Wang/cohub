import assert from "node:assert/strict";
import { test } from "node:test";
import {
	persistSessionTurnsCacheSafely,
	readSessionTurnsCacheSafely,
} from "../lib/cache/repositories/session-turns-cache-safety.ts";

test("readSessionTurnsCacheSafely returns null when cache read throws", async () => {
	const warnings: unknown[] = [];
	const result = await readSessionTurnsCacheSafely({
		read: async () => {
			throw new Error("indexeddb unavailable");
		},
		onError: (error) => warnings.push(error),
	});

	assert.equal(result, null);
	assert.equal(warnings.length, 1);
	assert.match(String(warnings[0]), /indexeddb unavailable/);
});

test("persistSessionTurnsCacheSafely resolves false when cache write throws", async () => {
	const warnings: unknown[] = [];
	const ok = await persistSessionTurnsCacheSafely({
		write: async () => {
			throw new Error("indexeddb write failed");
		},
		onError: (error) => warnings.push(error),
	});

	assert.equal(ok, false);
	assert.equal(warnings.length, 1);
	assert.match(String(warnings[0]), /indexeddb write failed/);
});

test("persistSessionTurnsCacheSafely resolves true on success", async () => {
	let written = false;
	const ok = await persistSessionTurnsCacheSafely({
		write: async () => {
			written = true;
		},
	});

	assert.equal(ok, true);
	assert.equal(written, true);
});
