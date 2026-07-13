import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import {
  buildPublicObjectUrl,
  cacheBuster,
  createPresignedPostObject,
  createPresignedPutObjectUrl,
  type PresignStorageConfig,
} from "./object-presign.js";
import { redisCommandClient } from "./redis.js";

const IMMUTABLE_PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type PublicAssetPurpose = "user_avatar" | "space_avatar" | "chat_attachment";

export type CreatePublicAssetUploadInput = {
  purpose: PublicAssetPurpose;
  spaceId?: string;
  sessionId?: string;
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

export type CreateInternalPublicAssetUploadResponse = {
  expiresAt: string;
  asset: {
    purpose: PublicAssetPurpose;
    objectKey: string;
    publicUrl: string;
    uploadMethod: "PUT";
    uploadUrl: string;
    uploadHeaders?: Record<string, string>;
  };
};

const IMAGE_MIME_TYPES = new Set(["image/webp", "image/jpeg"]);
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** Vision/CDN specialization limit for preprocessed chat images (webp/jpeg). Not a general file-upload cap. */
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Avatar-only abuse guard. */
const AVATAR_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const AVATAR_RATE_LIMIT_MAX = 60;
/** Chat image specialization (durable CDN) — looser than avatar; failures demote to file upload. */
const CHAT_ATTACHMENT_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const CHAT_ATTACHMENT_RATE_LIMIT_MAX = 300;

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

const getInternalStorageConfig = (): PresignStorageConfig => {
  const storage = getStorageConfig();
  return { ...storage, publicEndpoint: storage.endpoint };
};

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
  mimeType: string;
  spaceId?: string;
  sessionId?: string;
}) => {
  const extension = IMAGE_EXTENSIONS[input.mimeType];
  if (!extension) throw new PublicAssetValidationError("image uploads must be WebP or JPEG images");
  if (input.purpose === "user_avatar") return `${envPrefix()}users/${input.userUuid}/avatar.${extension}`;
  if (input.purpose === "space_avatar") {
    if (!input.spaceId) throw new PublicAssetValidationError("spaceId is required for space avatar uploads");
    return `${envPrefix()}spaces/${input.spaceId}/avatar.${extension}`;
  }
  // Chat attachments are user-scoped. spaceId/sessionId are optional association only.
  return `${envPrefix()}chat-attachments/${input.userUuid}/${randomUUID()}.${extension}`;
};

export const buildPublicAssetUrl = (objectKey: string) => {
  return config.publicAssetCdnBaseUrl
    ? `${config.publicAssetCdnBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`
    : buildPublicObjectUrl(requirePublicAssetConfig(), objectKey);
};

export const buildVersionedPublicAssetUrl = (objectKey: string) => `${buildPublicAssetUrl(objectKey)}?v=${cacheBuster()}`;

export const assertPublicAssetUploadFile = (input: { purpose: PublicAssetPurpose; file: CreatePublicAssetUploadInput["file"] }) => {
  const { file } = input;
  if (!file || typeof file !== "object") throw new PublicAssetValidationError("file is required");
  if (!IMAGE_MIME_TYPES.has(file.mimeType)) throw new PublicAssetValidationError("image uploads must be WebP or JPEG images");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new PublicAssetValidationError("invalid file size");
  const maxBytes = input.purpose === "chat_attachment" ? MAX_CHAT_ATTACHMENT_BYTES : MAX_AVATAR_BYTES;
  if (file.size > maxBytes) throw new PublicAssetValidationError(input.purpose === "chat_attachment" ? "chat image is too large" : "avatar image is too large");
};

export const consumePublicAssetUploadQuota = async (
  userUuid: string,
  purpose: PublicAssetPurpose = "user_avatar",
) => {
  if (purpose === "chat_attachment") {
    const key = `chat_attachment_upload:${userUuid}`;
    const count = await redisCommandClient.incr(key);
    if (count === 1) await redisCommandClient.expire(key, CHAT_ATTACHMENT_RATE_LIMIT_WINDOW_SECONDS);
    if (count > CHAT_ATTACHMENT_RATE_LIMIT_MAX) {
      throw new PublicAssetValidationError("too many image uploads, please try again later");
    }
    return;
  }
  const key = `public_asset_upload:${userUuid}`;
  const count = await redisCommandClient.incr(key);
  if (count === 1) await redisCommandClient.expire(key, AVATAR_RATE_LIMIT_WINDOW_SECONDS);
  if (count > AVATAR_RATE_LIMIT_MAX) {
    throw new PublicAssetValidationError("too many image uploads, please try again later");
  }
};

export const createPublicAssetUploadPlan = (input: {
  purpose: PublicAssetPurpose;
  userUuid: string;
  spaceId?: string;
  sessionId?: string;
  file: CreatePublicAssetUploadInput["file"];
}): CreatePublicAssetUploadResponse => {
  assertPublicAssetUploadFile({ purpose: input.purpose, file: input.file });
  const storage = requirePublicAssetConfig();
  const objectKey = buildPublicAssetObjectKey({
    purpose: input.purpose,
    userUuid: input.userUuid,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    mimeType: input.file.mimeType,
  });
  const signed = createPresignedPostObject({
    storage,
    objectKey,
    contentType: input.file.mimeType,
    maxBytes: input.purpose === "chat_attachment" ? MAX_CHAT_ATTACHMENT_BYTES : MAX_AVATAR_BYTES,
    cacheControl: input.purpose === "chat_attachment" ? IMMUTABLE_PUBLIC_CACHE_CONTROL : undefined,
  });
  return {
    expiresAt: signed.expiresAt,
    asset: {
      purpose: input.purpose,
      objectKey,
      publicUrl: input.purpose === "chat_attachment" ? buildPublicAssetUrl(objectKey) : buildVersionedPublicAssetUrl(objectKey),
      uploadMethod: "POST",
      uploadUrl: signed.uploadUrl,
      uploadFields: signed.fields,
    },
  };
};

export const createInternalPublicAssetUploadPlan = (input: {
  purpose: PublicAssetPurpose;
  userUuid: string;
  spaceId?: string;
  sessionId?: string;
  file: CreatePublicAssetUploadInput["file"];
}): CreateInternalPublicAssetUploadResponse => {
  assertPublicAssetUploadFile({ purpose: input.purpose, file: input.file });
  requirePublicAssetConfig();
  const objectKey = buildPublicAssetObjectKey({
    purpose: input.purpose,
    userUuid: input.userUuid,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    mimeType: input.file.mimeType,
  });
  const signed = createPresignedPutObjectUrl(
    getInternalStorageConfig(),
    objectKey,
    input.file.mimeType,
    input.purpose === "chat_attachment" ? IMMUTABLE_PUBLIC_CACHE_CONTROL : undefined,
  );
  return {
    expiresAt: signed.expiresAt,
    asset: {
      purpose: input.purpose,
      objectKey,
      publicUrl: input.purpose === "chat_attachment" ? buildPublicAssetUrl(objectKey) : buildVersionedPublicAssetUrl(objectKey),
      uploadMethod: "PUT",
      uploadUrl: signed.uploadUrl,
      uploadHeaders: signed.headers,
    },
  };
};
