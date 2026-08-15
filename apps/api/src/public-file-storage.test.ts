import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "./config.js";
import {
  buildPublicFileObjectKey,
  buildPublicFileUrl,
  createPublicFileUpload,
  normalizePublicFilePath,
  PUBLIC_FILE_CACHE_CONTROL,
  PublicFileValidationError,
} from "./public-file-storage.js";

const originalStorage = {
  publicAssetCdnBaseUrl: config.publicAssetCdnBaseUrl,
  publicAssetOssEndpoint: config.publicAssetOssEndpoint,
  publicAssetOssPublicEndpoint: config.publicAssetOssPublicEndpoint,
  publicAssetOssBucket: config.publicAssetOssBucket,
  publicAssetOssAccessKeyId: config.publicAssetOssAccessKeyId,
  publicAssetOssSecretAccessKey: config.publicAssetOssSecretAccessKey,
};

before(() => {
  config.publicAssetCdnBaseUrl = "https://public.example.com";
  config.publicAssetOssEndpoint = "https://oss.example.com";
  config.publicAssetOssPublicEndpoint = "https://oss.example.com";
  config.publicAssetOssBucket = "public-bucket";
  config.publicAssetOssAccessKeyId = "test-key";
  config.publicAssetOssSecretAccessKey = "test-secret";
});

after(() => {
  Object.assign(config, originalStorage);
});

describe("public file paths", () => {
  it("keeps public files in a space-scoped p prefix", () => {
    const expectedPrefix = config.env === "prod" ? "" : `${config.env}/`;
    assert.equal(
      buildPublicFileObjectKey("space-id", "demo/index.html"),
      `${expectedPrefix}p/space-id/demo/index.html`,
    );
    assert.equal(
      buildPublicFileUrl("space-id", "demo/index.html"),
      `https://public.example.com/${expectedPrefix}p/space-id/demo/index.html`,
    );
  });

  it("normalizes separators and rejects path traversal", () => {
    assert.equal(normalizePublicFilePath("./demo\\index.html"), "demo/index.html");
    assert.throws(() => normalizePublicFilePath("../secret"), PublicFileValidationError);
    assert.throws(() => normalizePublicFilePath("demo//index.html"), PublicFileValidationError);
    assert.throws(() => normalizePublicFilePath("/demo/index.html"), PublicFileValidationError);
    assert.throws(() => normalizePublicFilePath("demo/line\nbreak"), PublicFileValidationError);
    assert.throws(() => normalizePublicFilePath("demo/\u001b]52;clipboard"), PublicFileValidationError);
  });

  it("uses a cache policy that reuses fresh responses and revalidates updates", () => {
    assert.equal(PUBLIC_FILE_CACHE_CONTROL, "public, max-age=300, stale-while-revalidate=3600");
  });

  it("presigns browser-previewable files with bounded and conditional PUTs", () => {
    const input = {
      entries: [{
        id: "index",
        relativePath: "demo/index.html",
        size: 128,
        mimeType: "text/html; charset=utf-8",
      }],
    };
    const createOnlyPlan = createPublicFileUpload("space-id", input);
    assert.deepEqual(createOnlyPlan.entries[0]?.headers, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": PUBLIC_FILE_CACHE_CONTROL,
      "content-length": "128",
      "if-none-match": "*",
    });

    const overwritePlan = createPublicFileUpload("space-id", { ...input, overwrite: true });
    assert.equal(overwritePlan.entries[0]?.publicUrl.endsWith("/p/space-id/demo/index.html"), true);
    assert.deepEqual(overwritePlan.entries[0]?.headers, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": PUBLIC_FILE_CACHE_CONTROL,
      "content-length": "128",
    });
    assert.equal("content-disposition" in (overwritePlan.entries[0]?.headers ?? {}), false);
  });
});
