import assert from "node:assert/strict";
import test from "node:test";
import { isTransientGenerationWatchError } from "$lib/board/generation-watch-policy";

test("generation task watcher retries only transient transport errors", () => {
	assert.equal(
		isTransientGenerationWatchError(new TypeError("fetch failed")),
		true,
	);
	assert.equal(isTransientGenerationWatchError({ status: 503 }), true);
	assert.equal(isTransientGenerationWatchError({ status: 429 }), true);
	assert.equal(isTransientGenerationWatchError({ status: 403 }), false);
	assert.equal(
		isTransientGenerationWatchError(new Error("Generation task failed")),
		false,
	);
});
