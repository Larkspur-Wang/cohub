import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedImageBlob } from "$lib/board/board-image-export";

test("Board background downloads stop before buffering an oversized response", async () => {
	let canceled = false;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([1, 2, 3]));
		},
		cancel() {
			canceled = true;
		},
	});
	await assert.rejects(
		readBoundedImageBlob(
			new Response(body, { headers: { "content-type": "image/png" } }),
			"image/png",
			2,
		),
		/download limit/,
	);
	assert.equal(canceled, true);
});
