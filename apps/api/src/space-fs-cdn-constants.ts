import { COHUB_SYSTEM_FS_QUEUE } from "@cohub/bullmq-ops";

export const FS_CDN_QUEUE_NAME = COHUB_SYSTEM_FS_QUEUE;
export const FS_CDN_WARM_FILE_JOB = "cdn_cache.warm_file";

export const FS_CDN_LARGE_FILE_THRESHOLD_BYTES = 2 * 1024 * 1024;
export const FS_CDN_MANIFEST_TTL_SECONDS = Math.floor(6.5 * 24 * 60 * 60);
export const FS_CDN_FAIL_TTL_SECONDS = 60;
export const FS_CDN_READ_WAIT_TIMEOUT_MS = 15_000;
export const FS_CDN_READ_MANY_WAIT_TIMEOUT_MS = 5_000;
export const FS_CDN_DOWNLOAD_WAIT_TIMEOUT_MS = 20_000;
export const FS_CDN_POLL_INTERVAL_MS = 250;

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
