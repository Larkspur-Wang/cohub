import { config } from "./config.js";
import {
  buildPublicObjectUrl,
  cacheBuster,
  createPresignedPostObject,
  type PresignStorageConfig,
} from "./object-presign.js";
import { redisCommandClient } from "./redis.js";

export type PublicAssetPurpose = "user_avatar" | "space_avatar";

export type CreatePublicAssetUploadInput = {
  purpose: PublicAssetPurpose;
  spaceId?: string;
  file: {
    size: number;
    mimeType: string;
  };
};

export type CreatePublicAssetUploadResponse = {
  expiresAt: string;
  asset: {
    purpose: PublicAssetPurpose;
    objectKey: string;
    publicUrl: string;
    uploadMethod: "POST";
    uploadUrl: string;
    uploadFields: Record<string, string>;
  };
};

const AVATAR_MIME_TYPE = "image/webp";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX = 60;

export class PublicAssetConfigError extends Error {
  override name = "PublicAssetConfigError";
}

export class PublicAssetValidationError extends Error {
  override name = "PublicAssetValidationError";
}

const getStorageConfig = (): PresignStorageConfig => ({
  endpoint: config.publicAssetOssEndpoint,
  publicEndpoint: config.publicAssetOssPublicEndpoint,
  region: config.publicAssetOssRegion,
  bucket: config.publicAssetOssBucket,
  accessKeyId: config.publicAssetOssAccessKeyId,
  secretAccessKey: config.publicAssetOssSecretAccessKey,
});

const requirePublicAssetConfig = () => {
  const storage = getStorageConfig();
  if (!storage.bucket) throw new PublicAssetConfigError("PUBLIC_ASSET_OSS_BUCKET is required for public asset uploads");
  if (!storage.endpoint) throw new PublicAssetConfigError("PUBLIC_ASSET_OSS_ENDPOINT is required for public asset uploads");
  if (!storage.accessKeyId || !storage.secretAccessKey) {
    throw new PublicAssetConfigError("PUBLIC_ASSET_OSS_ACCESS_KEY_ID and PUBLIC_ASSET_OSS_SECRET_ACCESS_KEY are required for public asset uploads");
  }
  return storage;
};

const envPrefix = () => (config.env === "prod" ? "" : `${config.env}/`);

export const buildPublicAssetObjectKey = (input: {
  purpose: PublicAssetPurpose;
  userUuid: string;
  spaceId?: string;
}) => {
  if (input.purpose === "user_avatar") return `${envPrefix()}users/${input.userUuid}/avatar.webp`;
  if (!input.spaceId) throw new PublicAssetValidationError("spaceId is required for space avatar uploads");
  return `${envPrefix()}spaces/${input.spaceId}/avatar.webp`;
};

export const buildVersionedPublicAssetUrl = (objectKey: string) => {
  const baseUrl = config.publicAssetCdnBaseUrl
    ? `${config.publicAssetCdnBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`
    : buildPublicObjectUrl(requirePublicAssetConfig(), objectKey);
  return `${baseUrl}?v=${cacheBuster()}`;
};

export const assertPublicAssetUploadFile = (file: CreatePublicAssetUploadInput["file"]) => {
  if (!file || typeof file !== "object") throw new PublicAssetValidationError("file is required");
  if (file.mimeType !== AVATAR_MIME_TYPE) throw new PublicAssetValidationError("avatar uploads must be WebP images");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new PublicAssetValidationError("invalid file size");
  if (file.size > MAX_AVATAR_BYTES) throw new PublicAssetValidationError("avatar image is too large");
};

export const consumePublicAssetUploadQuota = async (userUuid: string) => {
  const key = `public_asset_upload:${userUuid}`;
  const count = await redisCommandClient.incr(key);
  if (count === 1) await redisCommandClient.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  if (count > RATE_LIMIT_MAX) throw new PublicAssetValidationError("too many avatar uploads, please try again later");
};

export const createPublicAssetUploadPlan = (input: {
  purpose: PublicAssetPurpose;
  userUuid: string;
  spaceId?: string;
  file: CreatePublicAssetUploadInput["file"];
}): CreatePublicAssetUploadResponse => {
  assertPublicAssetUploadFile(input.file);
  const storage = requirePublicAssetConfig();
  const objectKey = buildPublicAssetObjectKey(input);
  const signed = createPresignedPostObject({
    storage,
    objectKey,
    contentType: AVATAR_MIME_TYPE,
    maxBytes: MAX_AVATAR_BYTES,
  });
  return {
    expiresAt: signed.expiresAt,
    asset: {
      purpose: input.purpose,
      objectKey,
      publicUrl: buildVersionedPublicAssetUrl(objectKey),
      uploadMethod: "POST",
      uploadUrl: signed.uploadUrl,
      uploadFields: signed.fields,
    },
  };
};
