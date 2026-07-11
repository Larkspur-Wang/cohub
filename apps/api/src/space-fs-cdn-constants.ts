export {
  FS_CDN_FAIL_TTL_SECONDS,
  FS_CDN_LARGE_FILE_THRESHOLD_BYTES,
  FS_CDN_MANIFEST_TTL_SECONDS,
  type FsCdnManifest,
  type FsCdnWarmFileJob,
  type FsCdnWarmReason,
} from "@cohub/core/fs-cdn";

export const FS_CDN_WARM_FILE_JOB = "cdn_cache.warm_file";
export const FS_CDN_READ_WAIT_TIMEOUT_MS = 15_000;
export const FS_CDN_READ_MANY_WAIT_TIMEOUT_MS = 5_000;
export const FS_CDN_DOWNLOAD_WAIT_TIMEOUT_MS = 20_000;
export const FS_CDN_POLL_INTERVAL_MS = 250;
