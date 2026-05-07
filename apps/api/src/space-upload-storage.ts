import { createHash, createHmac, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";

const UPLOAD_TTL_SECONDS = 24 * 60 * 60;
const PRESIGN_TTL_SECONDS = 60 * 60;

export type SpaceUploadManifestEntry = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string | null;
  objectKey: string;
};

export type SpaceUploadManifest = {
  uploadId: string;
  spaceId: string;
  userId: string;
  targetDir: string;
  entries: SpaceUploadManifestEntry[];
  createdAt: string;
  expiresAt: string;
};

const requireObjectConfig = () => {
  if (!config.turnObjectS3Bucket) throw new Error("TURN_OBJECT_S3_BUCKET is required for uploads");
  if (!config.turnObjectS3Endpoint) throw new Error("TURN_OBJECT_S3_ENDPOINT is required for uploads");
  if (!config.turnObjectS3AccessKeyId || !config.turnObjectS3SecretAccessKey) {
    throw new Error("TURN_OBJECT_S3_ACCESS_KEY_ID and TURN_OBJECT_S3_SECRET_ACCESS_KEY are required for uploads");
  }
};

export const createSpaceUploadId = () => randomUUID();

export const buildSpaceUploadObjectKey = (input: { spaceId: string; uploadId: string; entryId: string }) => {
  const envPrefix = config.env === "prod" ? "" : `${config.env}/`;
  return `${envPrefix}uploads/${input.spaceId}/${input.uploadId}/${input.entryId}`;
};

const manifestKey = (spaceId: string, uploadId: string) => `space:fs:upload:${spaceId}:${uploadId}`;
const completeKey = (spaceId: string, uploadId: string) => `space:fs:upload:complete:${spaceId}:${uploadId}`;

export const saveSpaceUploadManifest = async (manifest: SpaceUploadManifest) => {
  await redisCommandClient.set(
    manifestKey(manifest.spaceId, manifest.uploadId),
    JSON.stringify(manifest),
    "EX",
    UPLOAD_TTL_SECONDS,
  );
};

export const getSpaceUploadManifest = async (spaceId: string, uploadId: string) => {
  const raw = await redisCommandClient.get(manifestKey(spaceId, uploadId));
  return raw ? JSON.parse(raw) as SpaceUploadManifest : null;
};

export const deleteSpaceUploadManifest = async (spaceId: string, uploadId: string) => {
  await redisCommandClient.del(manifestKey(spaceId, uploadId));
};

export const beginSpaceUploadComplete = async (spaceId: string, uploadId: string) => {
  const key = completeKey(spaceId, uploadId);
  const ok = await redisCommandClient.set(key, "pending", "EX", UPLOAD_TTL_SECONDS, "NX");
  if (ok === "OK") return { acquired: true as const };
  return { acquired: false as const, taskRunId: await redisCommandClient.get(key) };
};

export const finishSpaceUploadComplete = async (spaceId: string, uploadId: string, taskRunId: string) => {
  await redisCommandClient.set(completeKey(spaceId, uploadId), taskRunId, "EX", UPLOAD_TTL_SECONDS);
};

export const cancelSpaceUploadComplete = async (spaceId: string, uploadId: string) => {
  const key = completeKey(spaceId, uploadId);
  const value = await redisCommandClient.get(key);
  if (value === "pending") await redisCommandClient.del(key);
};

const toAmzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");
const toDateStamp = (date: Date) => toAmzDate(date).slice(0, 8);
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
const hexHmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest("hex");

const signingKey = (secret: string, dateStamp: string, region: string) => {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
};

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

const publicEndpoint = () => {
  const endpoint = config.turnObjectS3PublicEndpoint ?? config.turnObjectS3Endpoint?.replace("-internal.", ".");
  if (!endpoint) throw new Error("TURN_OBJECT_S3_ENDPOINT is required for uploads");
  return endpoint.replace(/\/+$/, "");
};

export const createPresignedPutUrl = (objectKey: string, contentType?: string | null) => {
  requireObjectConfig();
  const accessKeyId = config.turnObjectS3AccessKeyId as string;
  const secretAccessKey = config.turnObjectS3SecretAccessKey as string;
  const region = config.turnObjectS3Region;
  const bucket = config.turnObjectS3Bucket as string;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const endpoint = publicEndpoint();
  const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodePath(objectKey)}`);
  const signedHeaders = "host";
  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${accessKeyId}/${credentialScope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_TTL_SECONDS));
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);

  const canonicalQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalRequest = [
    "PUT",
    url.pathname,
    canonicalQuery,
    `host:${url.host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hexHmac(signingKey(secretAccessKey, dateStamp, region), stringToSign);
  url.searchParams.set("X-Amz-Signature", signature);

  return {
    uploadUrl: url.toString(),
    expiresAt: new Date(now.getTime() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
    headers: contentType ? { "content-type": contentType } : undefined,
  };
};

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
