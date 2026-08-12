import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "./config.js";
import {
  assertPublicAssetUploadFile,
  buildPublicAssetObjectKey,
  createPublicAssetUploadPlan,
} from "./public-asset-storage.js";

const storageConfig = {
  userUploadS3Endpoint: config.userUploadS3Endpoint,
  userUploadS3AccessKeyId: config.userUploadS3AccessKeyId,
  userUploadS3SecretAccessKey: config.userUploadS3SecretAccessKey,
  chatAttachmentS3Bucket: config.chatAttachmentS3Bucket,
  chatAttachmentPublicBaseUrl: config.chatAttachmentPublicBaseUrl,
};

before(() => {
  config.userUploadS3Endpoint = "https://account.r2.cloudflarestorage.com";
  config.userUploadS3AccessKeyId = "test-access-key";
  config.userUploadS3SecretAccessKey = "test-secret-key";
  config.chatAttachmentS3Bucket = "user-uploads";
  config.chatAttachmentPublicBaseUrl = "https://uploads.example.com";
});

after(() => {
  Object.assign(config, storageConfig);
});

describe("avatar public assets", () => {
  const prefix = config.env === "prod" ? "" : `${config.env}/`;

  it("generates a unique owner-scoped object key for every upload", () => {
    const input = {
      purpose: "user_avatar" as const,
      userUuid: "user-id",
      mimeType: "image/webp",
    };
    const first = buildPublicAssetObjectKey(input);
    const second = buildPublicAssetObjectKey(input);

    assert.match(first, new RegExp(`^${prefix}avatars/users/user-id/[0-9a-f-]{36}\\.webp$`));
    assert.notEqual(first, second);
    assert.match(buildPublicAssetObjectKey({
      purpose: "space_avatar",
      userUuid: "user-id",
      spaceId: "space-id",
      mimeType: "image/gif",
    }), new RegExp(`^${prefix}avatars/spaces/space-id/[0-9a-f-]{36}\\.gif$`));
  });

  it("accepts browser avatar formats up to 4 MiB", () => {
    for (const mimeType of ["image/webp", "image/jpeg", "image/png", "image/gif"]) {
      assert.doesNotThrow(() => assertPublicAssetUploadFile({
        purpose: "user_avatar",
        file: { size: 4 * 1024 * 1024, mimeType },
      }));
    }
    assert.throws(
      () => assertPublicAssetUploadFile({
        purpose: "user_avatar",
        file: { size: 4 * 1024 * 1024 + 1, mimeType: "image/gif" },
      }),
      /avatar image is too large/,
    );
  });

  it("uses the chat attachment bucket with immutable PUT headers", () => {
    const plan = createPublicAssetUploadPlan({
      purpose: "space_avatar",
      uploadProtocol: "presigned_put_v1",
      userUuid: "user-id",
      spaceId: "space-id",
      file: { size: 100, mimeType: "image/png", filename: "avatar.png" },
    });

    assert.equal(plan.asset.uploadMethod, "PUT");
    assert.match(
      plan.asset.objectKey,
      new RegExp(`^${prefix}avatars/spaces/space-id/[0-9a-f-]{36}\\.png$`),
    );
    assert.equal(plan.asset.publicUrl, `https://uploads.example.com/${plan.asset.objectKey}`);
    assert.equal(plan.asset.publicUrl.includes("?"), false);
    assert.deepEqual(plan.asset.uploadHeaders, {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
    });
    assert.match(plan.asset.uploadUrl, /^https:\/\/user-uploads\.account\.r2\.cloudflarestorage\.com\//);
  });
});
