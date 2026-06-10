import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildPublicObjectUrl, cacheBuster, type PresignStorageConfig } from "./object-presign.js";
import { config } from "./config.js";

const MAX_WORK_ASSET_BYTES = 5 * 1024 * 1024;

let s3Client: S3Client | null = null;

const getStorage = (): PresignStorageConfig => ({
  endpoint: config.publicAssetOssEndpoint,
  publicEndpoint: config.publicAssetOssPublicEndpoint,
  region: config.publicAssetOssRegion,
  bucket: config.publicAssetOssBucket,
  accessKeyId: config.publicAssetOssAccessKeyId,
  secretAccessKey: config.publicAssetOssSecretAccessKey,
});

const requireStorage = () => {
  const storage = getStorage();
  if (!storage.bucket || !storage.endpoint || !storage.accessKeyId || !storage.secretAccessKey) {
    throw new Error("work asset storage is not configured");
  }
  return storage;
};

const getS3Client = () => {
  const storage = requireStorage();
  s3Client ??= new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    forcePathStyle: false,
    credentials: {
      accessKeyId: storage.accessKeyId!,
      secretAccessKey: storage.secretAccessKey!,
    },
  });
  return s3Client;
};

const envPrefix = () => (config.env === "prod" ? "" : `${config.env}/`);

export const buildWorkAssetObjectKey = (input: { spaceId: string; workSlug: string }) =>
  `${envPrefix()}works/${input.spaceId}/${input.workSlug}-${cacheBuster()}/index.html`;

export const createWorkAssetPublicUrl = (objectKey: string) => buildPublicObjectUrl(requireStorage(), objectKey);

export const writeWorkHtmlAsset = async (input: {
  spaceId: string;
  workSlug: string;
  html: string;
}) => {
  const content = input.html;
  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes <= 0 || sizeBytes > MAX_WORK_ASSET_BYTES) {
    throw new Error("work asset must be 1 byte to 5MB");
  }
  const objectKey = buildWorkAssetObjectKey({ spaceId: input.spaceId, workSlug: input.workSlug });
  const sha256 = createHash("sha256").update(content).digest("hex");
  await getS3Client().send(new PutObjectCommand({
    Bucket: requireStorage().bucket,
    Key: objectKey,
    Body: content,
    ContentType: "text/html; charset=utf-8",
    Metadata: { sha256 },
  }));
  return {
    objectKey,
    publicUrl: createWorkAssetPublicUrl(objectKey),
    sizeBytes,
    sha256,
  };
};
