import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type ComposerFileAttachment,
	summarizeComposerAttachmentUpload,
} from "$lib/composer-attachments";

function attachment(
	id: string,
	size: number,
	status: ComposerFileAttachment["status"],
	progress?: number,
): ComposerFileAttachment {
	return {
		kind: "file",
		id,
		name: `${id}.bin`,
		relativePath: `${id}.bin`,
		mediaType: "application/octet-stream",
		file: new File([new Uint8Array(size)], `${id}.bin`),
		size,
		status,
		progress,
	};
}

describe("composer attachment upload progress", () => {
	it("weights parallel progress by bytes", () => {
		const summary = summarizeComposerAttachmentUpload([
			attachment("small", 100, "uploading", 50),
			attachment("large", 300, "finalizing", 100),
		]);

		assert.deepEqual(summary, {
			stage: "uploading",
			progress: 88,
			count: 2,
		});
	});

	it("separates finalizing from network upload progress", () => {
		assert.deepEqual(
			summarizeComposerAttachmentUpload([
				attachment("one", 100, "finalizing", 100),
				attachment("two", 200, "finalizing", 100),
			]),
			{ stage: "finalizing", progress: 100, count: 2 },
		);
		assert.equal(
			summarizeComposerAttachmentUpload([attachment("ready", 100, "ready")]),
			null,
		);
	});
});
