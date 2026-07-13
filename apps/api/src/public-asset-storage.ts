import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import {
  buildPublicObjectUrl,
  cacheBuster,
  createPresignedPostObject,
  createPresignedPutObjectUrl,
  getBucketPublicEndpoint,
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
    /** Optional original name — used only for chat_attachment object key extension. */
    filename?: string;
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

/** Common mime → extension for chat attachments (fallback when filename has no ext). */
const CHAT_MIME_EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
  "application/json": "json",
  "application/xml": "xml",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/octet-stream": "bin",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/**
 * Chat durable object (any file). Public URL; UUID-unguessable.
 * Body goes client → OSS via presign (not through API). Align with space upload single-file cap.
 */
export const MAX_CHAT_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
/** Avatar-only abuse guard. */
const AVATAR_RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const AVATAR_RATE_LIMIT_MAX = 60;
/** Chat attachment durable uploads — looser than avatar. */
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

const safeExtensionFromFilename = (filename: string | undefined) => {
  if (!filename) return null;
  const base = filename.split(/[/\\]/).pop()?.trim() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(ext)) return null;
  return ext;
};

const extensionForChatAttachment = (input: { mimeType: string; filename?: string }) => {
  const fromName = safeExtensionFromFilename(input.filename);
  if (fromName) return fromName;
  const fromMime = CHAT_MIME_EXTENSIONS[input.mimeType.toLowerCase()];
  if (fromMime) return fromMime;
  return "bin";
};

/** Active web content must not be served as navigable public assets. */
const ACTIVE_PUBLIC_MIME_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "text/css",
]);

const normalizeChatMimeType = (mimeType: unknown) => {
  if (typeof mimeType !== "string") throw new PublicAssetValidationError("invalid mime type");
  const value = mimeType.trim().toLowerCase();
  if (!value || value.length > 255) throw new PublicAssetValidationError("invalid mime type");
  // Basic type/subtype check; allow +suffix (e.g. application/ld+json).
  if (!/^[a-z0-9!#$&\-^_.+]{1,127}\/[a-z0-9!#$&\-^_.+]{1,127}$/i.test(value)) {
    throw new PublicAssetValidationError("invalid mime type");
  }
  // Force non-executable content-type for active formats (still stored; not rendered inline).
  if (ACTIVE_PUBLIC_MIME_TYPES.has(value)) return "application/octet-stream";
  return value;
};

const chatAttachmentContentDisposition = (filename?: string) => {
  const raw = (filename ?? "attachment").split(/[/\\]/).pop()?.trim() || "attachment";
  const safe = raw.replace(/[\r\n"]/g, "_").slice(0, 180) || "attachment";
  return `attachment; filename="${safe}"`;
};

export const buildPublicAssetObjectKey = (input: {
  purpose: PublicAssetPurpose;
  userUuid: string;
  mimeType: string;
  spaceId?: string;
  sessionId?: string;
  filename?: string;
}) => {
  if (input.purpose === "user_avatar" || input.purpose === "space_avatar") {
    const extension = IMAGE_EXTENSIONS[input.mimeType];
    if (!extension) throw new PublicAssetValidationError("image uploads must be WebP or JPEG images");
    if (input.purpose === "user_avatar") return `${envPrefix()}users/${input.userUuid}/avatar.${extension}`;
    if (!input.spaceId) throw new PublicAssetValidationError("spaceId is required for space avatar uploads");
    return `${envPrefix()}spaces/${input.spaceId}/avatar.${extension}`;
  }
  // Chat attachments are user-scoped. spaceId/sessionId are optional association only.
  const extension = extensionForChatAttachment({
    mimeType: input.mimeType,
    filename: input.filename,
  });
  return `${envPrefix()}chat-attachments/${input.userUuid}/${randomUUID()}.${extension}`;
};

export const buildPublicAssetUrl = (objectKey: string) => {
  return config.publicAssetCdnBaseUrl
    ? `${config.publicAssetCdnBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`
    : buildPublicObjectUrl(requirePublicAssetConfig(), objectKey);
};

export const buildVersionedPublicAssetUrl = (objectKey: string) => `${buildPublicAssetUrl(objectKey)}?v=${cacheBuster()}`;

const encodeObjectKeyPath = (objectKey: string) =>
  objectKey.split("/").filter(Boolean).map(encodeURIComponent).join("/");

const tryParseOrigin = (value: string | undefined) => {
  if (!value) return null;
  try {
    return new URL(value.replace(/\/+$/, "")).origin;
  } catch {
    return null;
  }
};

/** Origins clients may pass as chat durable downloadUrl (CDN / public OSS). */
export const listPublicAssetClientOrigins = () => {
  const origins = new Set<string>();
  const cdn = tryParseOrigin(config.publicAssetCdnBaseUrl);
  if (cdn) origins.add(cdn);
  if (config.publicAssetOssBucket) {
    const publicEndpoint =
      config.publicAssetOssPublicEndpoint ??
      config.publicAssetOssEndpoint?.replace("-internal.", ".");
    if (publicEndpoint) {
      try {
        const parsed = new URL(publicEndpoint.replace(/\/+$/, ""));
        if (!parsed.hostname.startsWith(`${config.publicAssetOssBucket}.`)) {
          parsed.hostname = `${config.publicAssetOssBucket}.${parsed.hostname}`;
        }
        origins.add(parsed.origin);
      } catch {
        // ignore invalid config
      }
    }
  }
  return origins;
};

export const isAllowedPublicAssetDownloadUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const origins = listPublicAssetClientOrigins();
  return origins.size > 0 && origins.has(url.origin);
};

/** Extract object key from a known public CDN / public OSS URL. */
export const publicAssetObjectKeyFromUrl = (value: string): string | null => {
  if (!isAllowedPublicAssetDownloadUrl(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  // Strip CDN base path prefix when CDN is mounted under a subpath.
  if (config.publicAssetCdnBaseUrl) {
    try {
      const cdn = new URL(config.publicAssetCdnBaseUrl.replace(/\/+$/, ""));
      if (url.origin === cdn.origin) {
        const prefix = cdn.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
        if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
          path = path === prefix ? "" : path.slice(prefix.length + 1);
        }
      }
    } catch {
      // ignore
    }
  }
  if (!path || path.includes("..")) return null;
  return path;
};

/**
 * Rewrite a public durable URL to the internal OSS endpoint for sandbox materialize.
 * Falls back to the original URL when internal endpoint is unavailable or URL is not ours.
 */
export const resolvePublicAssetDownloadUrlForInternal = (value: string): string | null => {
  if (!isAllowedPublicAssetDownloadUrl(value)) return null;
  const objectKey = publicAssetObjectKeyFromUrl(value);
  if (!objectKey) return null;

  // Prefer internal OSS endpoint when configured (in-cluster / VPC pull).
  const internalEndpoint = config.publicAssetOssEndpoint;
  const bucket = config.publicAssetOssBucket;
  if (internalEndpoint && bucket) {
    try {
      const base = getBucketPublicEndpoint({
        endpoint: internalEndpoint,
        publicEndpoint: internalEndpoint,
        region: config.publicAssetOssRegion,
        bucket,
      });
      return `${base.replace(/\/+$/, "")}/${encodeObjectKeyPath(objectKey)}`;
    } catch {
      // fall through to original public URL
    }
  }
  return value;
};

export const assertPublicAssetUploadFile = (input: {
  purpose: PublicAssetPurpose;
  file: CreatePublicAssetUploadInput["file"];
}) => {
  const { file } = input;
  if (!file || typeof file !== "object") throw new PublicAssetValidationError("file is required");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new PublicAssetValidationError("invalid file size");

  if (input.purpose === "chat_attachment") {
    normalizeChatMimeType(file.mimeType);
    if (file.filename != null && (typeof file.filename !== "string" || file.filename.length > 255)) {
      throw new PublicAssetValidationError("invalid filename");
    }
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new PublicAssetValidationError("chat attachment is too large");
    }
    return;
  }

  if (!IMAGE_MIME_TYPES.has(file.mimeType)) throw new PublicAssetValidationError("image uploads must be WebP or JPEG images");
  if (file.size > MAX_AVATAR_BYTES) throw new PublicAssetValidationError("avatar image is too large");
};

export const consumePublicAssetUploadQuota = async (
  userUuid: string,
  purpose: PublicAssetPurpose = "user_avatar",
  entryCount = 1,
) => {
  const n = Math.max(0, Math.floor(entryCount));
  if (n <= 0) return;
  if (purpose === "chat_attachment") {
    const key = `chat_attachment_upload:${userUuid}`;
    const next = await redisCommandClient.incrby(key, n);
    if (next === n) await redisCommandClient.expire(key, CHAT_ATTACHMENT_RATE_LIMIT_WINDOW_SECONDS);
    if (next > CHAT_ATTACHMENT_RATE_LIMIT_MAX) {
      await redisCommandClient.decrby(key, n).catch(() => undefined);
      throw new PublicAssetValidationError("too many uploads, please try again later");
    }
    return;
  }
  const key = `public_asset_upload:${userUuid}`;
  const next = await redisCommandClient.incrby(key, n);
  if (next === n) await redisCommandClient.expire(key, AVATAR_RATE_LIMIT_WINDOW_SECONDS);
  if (next > AVATAR_RATE_LIMIT_MAX) {
    await redisCommandClient.decrby(key, n).catch(() => undefined);
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
  const mimeType =
    input.purpose === "chat_attachment"
      ? normalizeChatMimeType(input.file.mimeType)
      : input.file.mimeType;
  const objectKey = buildPublicAssetObjectKey({
    purpose: input.purpose,
    userUuid: input.userUuid,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    mimeType,
    filename: input.file.filename,
  });
  const maxBytes = input.purpose === "chat_attachment" ? MAX_CHAT_ATTACHMENT_BYTES : MAX_AVATAR_BYTES;
  const signed = createPresignedPostObject({
    storage,
    objectKey,
    contentType: mimeType,
    maxBytes,
    cacheControl: input.purpose === "chat_attachment" ? IMMUTABLE_PUBLIC_CACHE_CONTROL : undefined,
    contentDisposition:
      input.purpose === "chat_attachment"
        ? chatAttachmentContentDisposition(input.file.filename)
        : undefined,
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
  const mimeType =
    input.purpose === "chat_attachment"
      ? normalizeChatMimeType(input.file.mimeType)
      : input.file.mimeType;
  const objectKey = buildPublicAssetObjectKey({
    purpose: input.purpose,
    userUuid: input.userUuid,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    mimeType,
    filename: input.file.filename,
  });
  const signed = createPresignedPutObjectUrl(
    getInternalStorageConfig(),
    objectKey,
    mimeType,
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
