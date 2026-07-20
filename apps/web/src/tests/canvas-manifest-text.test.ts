import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCanvasManifestText } from "../lib/canvas/canvas-manifest-text.ts";

const manifest = `{
  "kind": "cohub.canvas.manifest",
  "version": 1,
  "documentId": "doc_123",
  "title": "Untitled.covas"
}
`;

describe("resolveCanvasManifestText", () => {
	it("returns utf-8 content for text responses", () => {
		const content = resolveCanvasManifestText({
			path: "board.covas",
			name: "board.covas",
			size: manifest.length,
			mimeType: "application/json",
			mtimeMs: Date.now(),
			kind: "text",
			encoding: "utf-8",
			content: manifest,
			delivery: "inline",
		});
		assert.equal(content, manifest);
	});

	it("recovers JSON text from legacy base64 binary .covas responses", () => {
		const content = resolveCanvasManifestText({
			path: "board.covas",
			name: "board.covas",
			size: manifest.length,
			mimeType: null,
			mtimeMs: Date.now(),
			kind: "binary",
			encoding: "base64",
			content: Buffer.from(manifest, "utf8").toString("base64"),
			delivery: "inline",
		});
		assert.equal(content, manifest);
	});

	it("rejects non-JSON binary payloads", () => {
		const content = resolveCanvasManifestText({
			path: "board.covas",
			name: "board.covas",
			size: 4,
			mimeType: null,
			mtimeMs: Date.now(),
			kind: "binary",
			encoding: "base64",
			content: Buffer.from("\0\0\0\0").toString("base64"),
			delivery: "inline",
		});
		assert.equal(content, null);
	});
});
