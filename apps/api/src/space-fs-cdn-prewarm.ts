import {
  buildFsCdnFailKey,
  createFsCdnWarmJobsForChanges,
  FS_CDN_FAIL_TTL_SECONDS,
} from "@cohub/core/fs-cdn";
import type { SpaceFsChange } from "@cohub/protocol/fs";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";
import { enqueueFsCdnWarmFile } from "./space-fs-cdn-queue.js";

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
