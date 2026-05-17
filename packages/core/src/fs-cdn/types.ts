export type FsCdnEnvironment = "dev" | "prod";

export const FS_CDN_LARGE_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024;
export const FS_CDN_MANIFEST_TTL_SECONDS = Math.floor(6.5 * 24 * 60 * 60);
export const FS_CDN_FAIL_TTL_SECONDS = 60;

export type FsCdnWarmReason = "fs_changed" | "read_miss" | "read_many_miss" | "download_miss";

export type FsCdnWarmFileJob = {
  spaceId: string;
  path: string;
  size: number;
  mtimeMs: number;
  mimeType: string | null;
  requestedAt: number;
  reason: FsCdnWarmReason;
};

export type FsCdnManifest = {
  path: string;
  pathHash: string;
  size: number;
  mtimeMs: number;
  mimeType: string | null;
  objectKey: string;
  url: string;
  createdAt: number;
  expiresAt: number;
};
