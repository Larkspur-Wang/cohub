import { COHUB_SYSTEM_FS_QUEUE } from "@cohub/infra/bullmq";
export {
  FS_CDN_FAIL_TTL_SECONDS,
  FS_CDN_LARGE_FILE_THRESHOLD_BYTES,
  FS_CDN_MANIFEST_TTL_SECONDS,
  type FsCdnManifest,
  type FsCdnWarmFileJob,
  type FsCdnWarmReason,
} from "@cohub/core/fs-cdn";

export const FS_CDN_QUEUE_NAME = COHUB_SYSTEM_FS_QUEUE;
export const FS_CDN_WARM_FILE_JOB = "cdn_cache.warm_file";
