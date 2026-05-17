import { createBullmqQueue } from "@cohub/infra/bullmq";
import type { SpaceFsChange } from "@cohub/protocol/fs";
import { config } from "./config.js";
import { redisCommandClient } from "./redis.js";
import {
  FS_CDN_FAIL_TTL_SECONDS,
  FS_CDN_QUEUE_NAME,
  FS_CDN_WARM_FILE_JOB,
  type FsCdnWarmFileJob,
  type FsCdnWarmReason,
} from "./system/jobs/fs-cdn-cache/types.js";
import { buildFsCdnFailKey, buildFsCdnJobId, shouldUseFsCdnCache } from "./system/jobs/fs-cdn-cache/policy.js";

const mimeByExt: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".jsx": "text/jsx",
  ".svelte": "text/x-svelte",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".html": "text/html",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".ini": "text/plain",
  ".env": "text/plain",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java-source",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++src",
  ".hpp": "text/x-c++hdr",
  ".sql": "application/sql",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const fsCdnQueue = createBullmqQueue<FsCdnWarmFileJob>(FS_CDN_QUEUE_NAME, {
  redisUrl: config.bullmqRedisUrl,
  telemetryServiceName: "cohub-worker-fs-cdn",
});

function getMimeType(path: string) {
  const basename = path.split("/").pop()?.toLowerCase() ?? "";
  if (basename === "dockerfile") return "text/x-dockerfile";
  if (basename === "makefile") return "text/x-makefile";
  if (basename.startsWith(".env")) return "text/plain";
  const dotIndex = basename.lastIndexOf(".");
  const ext = dotIndex >= 0 ? basename.slice(dotIndex) : "";
  return mimeByExt[ext] ?? null;
}

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
    removeOnComplete: { age: 3600, count: 10_000 },
    removeOnFail: { age: 6 * 3600, count: 10_000 },
  });
}

async function enqueueFsCdnWarmForMeta(input: {
  spaceId: string;
  path: string;
  size: number;
  mtimeMs: number;
  mimeType: string | null;
  reason: FsCdnWarmReason;
}) {
  const failKey = buildFsCdnFailKey({
    env: config.env,
    spaceId: input.spaceId,
    path: input.path,
    size: input.size,
    mtimeMs: input.mtimeMs,
  });
  if (await redisCommandClient.get(failKey)) return;
  await enqueueFsCdnWarmFile({
    spaceId: input.spaceId,
    path: input.path,
    size: input.size,
    mtimeMs: input.mtimeMs,
    mimeType: input.mimeType,
    requestedAt: Date.now(),
    reason: input.reason,
  }).catch(async (error) => {
    await redisCommandClient
      .set(failKey, error instanceof Error ? error.message : String(error), "EX", FS_CDN_FAIL_TTL_SECONDS)
      .catch(() => undefined);
    throw error;
  });
}

export async function enqueueFsCdnWarmForChanges(spaceId: string, changes: SpaceFsChange[]) {
  await Promise.allSettled(
    changes.map(async (change) => {
      if ((change.kind !== "create" && change.kind !== "modify") || change.nodeType !== "file") return;
      if (!change.path || change.size == null || change.mtimeMs == null) return;
      const mimeType = getMimeType(change.path);
      if (!shouldUseFsCdnCache({ path: change.path, mimeType, size: change.size })) return;
      await enqueueFsCdnWarmForMeta({
        spaceId,
        path: change.path,
        size: change.size,
        mtimeMs: change.mtimeMs,
        mimeType,
        reason: "fs_changed",
      });
    }),
  );
}
