import { Queue } from "bullmq";
import { BullMQOtel } from "bullmq-otel";
import { config } from "./config.js";
import {
  FS_CDN_QUEUE_NAME,
  FS_CDN_WARM_FILE_JOB,
  type FsCdnWarmFileJob,
} from "./space-fs-cdn-constants.js";
import { buildFsCdnJobId } from "./space-fs-cdn-policy.js";

const connection = { url: config.bullmqRedisUrl };

export const fsCdnQueue = new Queue(FS_CDN_QUEUE_NAME, {
  connection,
  telemetry: new BullMQOtel("cohub-api-fs-cdn"),
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
    removeOnComplete: { age: 3600, count: 10_000 },
    removeOnFail: { age: 6 * 3600, count: 10_000 },
  });
}
