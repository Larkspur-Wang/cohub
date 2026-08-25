import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "./config.js";
import { createUserUploadPutUrl } from "./user-upload-storage.js";

const storageConfig = {
  userUploadS3Endpoint: config.userUploadS3Endpoint,
  userUploadS3AccessKeyId: config.userUploadS3AccessKeyId,
  userUploadS3SecretAccessKey: config.userUploadS3SecretAccessKey,
  spaceUploadS3Bucket: config.spaceUploadS3Bucket,
};

before(() => {
  config.userUploadS3Endpoint = "https://account.r2.cloudflarestorage.com";
  config.userUploadS3AccessKeyId = "test-access-key";
  config.userUploadS3SecretAccessKey = "test-secret-key";
  config.spaceUploadS3Bucket = "space-uploads";
});

after(() => {
  Object.assign(config, storageConfig);
});

describe("user upload storage", () => {
  it("signs and returns the exact content length", () => {
    const signed = createUserUploadPutUrl({
      kind: "space_upload",
      objectKey: "uploads/space/upload/file",
      contentType: "text/plain",
      contentLength: 42,
    });
    const url = new URL(signed.uploadUrl);

    assert.match(url.searchParams.get("X-Amz-SignedHeaders") ?? "", /content-length/);
    assert.deepEqual(signed.headers, {
      "content-type": "text/plain",
      "content-length": "42",
    });
  });

  it("preserves a zero-byte content length", () => {
    const signed = createUserUploadPutUrl({
      kind: "space_upload",
      objectKey: "uploads/space/upload/empty",
      contentLength: 0,
    });

    assert.equal(signed.headers?.["content-length"], "0");
  });
});
