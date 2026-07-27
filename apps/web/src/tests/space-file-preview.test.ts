import assert from "node:assert/strict";
import { test } from "node:test";
import { isPdfFile } from "../lib/space-file-preview.ts";

test("recognizes PDFs by normalized MIME type", () => {
	assert.equal(
		isPdfFile({
			path: "documents/report.bin",
			mimeType: "Application/PDF; charset=binary",
		}),
		true,
	);
});

test("recognizes PDFs by extension when MIME metadata is missing", () => {
	assert.equal(
		isPdfFile({ path: "documents/report.PDF", mimeType: null }),
		true,
	);
	assert.equal(
		isPdfFile({ path: "documents/report.pdf.backup", mimeType: null }),
		false,
	);
});

test("rejects unrelated and missing files", () => {
	assert.equal(
		isPdfFile({ path: "documents/report.txt", mimeType: "text/plain" }),
		false,
	);
	assert.equal(isPdfFile(null), false);
});
