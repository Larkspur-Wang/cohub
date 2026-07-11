import { COHUB_SYSTEM_QUEUE, createBullmqQueue, defaultJobRetention } from "@cohub/infra/bullmq";
import type { SpaceFsChange } from "@cohub/protocol/fs";
import {
  buildFsCdnFailKey,
  buildFsCdnJobId,
  createFsCdnWarmJobsForChanges,
  FS_CDN_FAIL_TTL_SECONDS,
  type FsCdnWarmFileJob,
} from "@cohub/core/fs-cdn";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";
import { FS_CDN_WARM_FILE_JOB } from "./system/jobs/fs-cdn-cache/types.js";

const fsCdnQueue = createBullmqQueue<FsCdnWarmFileJob>(COHUB_SYSTEM_QUEUE, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-fs-cdn",
});

async function enqueueFsCdnWarmFile(payload: FsCdnWarmFileJob) {
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

export async function enqueueFsCdnWarmForChanges(spaceId: string, changes: SpaceFsChange[]) {
  await Promise.allSettled(
    createFsCdnWarmJobsForChanges({ spaceId, changes }).map(async (job) => {
      const failKey = buildFsCdnFailKey({
        env: config.env,
        spaceId: job.spaceId,
        path: job.path,
        size: job.size,
        mtimeMs: job.mtimeMs,
      });
      if (await redisCommandClient.get(failKey)) return;
      await enqueueFsCdnWarmFile(job).catch(async (error) => {
        await redisCommandClient
          .set(failKey, error instanceof Error ? error.message : String(error), "EX", FS_CDN_FAIL_TTL_SECONDS)
          .catch(() => undefined);
        throw error;
      });
    }),
  );
}
