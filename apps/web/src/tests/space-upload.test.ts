import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBrowserManagedUploadHeader } from "../lib/upload-headers.ts";

describe("space upload headers", () => {
	it("leaves content length to the browser", () => {
		assert.equal(isBrowserManagedUploadHeader("content-length"), true);
		assert.equal(isBrowserManagedUploadHeader("Content-Length"), true);
		assert.equal(isBrowserManagedUploadHeader("content-type"), false);
	});
});
