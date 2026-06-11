import { createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import { config } from "./config.js";
import {
  FS_CDN_QUEUE_NAME,
  FS_CDN_WARM_FILE_JOB,
  type FsCdnWarmFileJob,
} from "./space-fs-cdn-constants.js";
import { buildFsCdnJobId } from "./space-fs-cdn-policy.js";

export const fsCdnQueue = createBullmqQueue(FS_CDN_QUEUE_NAME, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-api-fs-cdn",
});

export async function enqueueFsCdnWarmFile(payload: FsCdnWarmFileJob) {
  return fsCdnQueue.add(FS_CDN_WARM_FILE_JOB, payload, {
    jobId: buildFsCdnJobId({
      env: config.env,
      spaceId: payload.spaceId,
      path: payload.path,
      size: payload.size,
      mtimeMs: payload.mtimeMs,
    }),
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    ...defaultJobRetention,
  });
}
