import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Job } from "bullmq";
import { config } from "../../../config.js";
import { registerSystemJob } from "../../registry.js";
import { WORK_PUBLISH_ASSET_JOB, type WorkPublishAssetJobData, type WorkPublishAssetJobResult } from "./types.js";

const MAX_WORK_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_WORK_SITE_BYTES = 100 * 1024 * 1024;
const MAX_WORK_SITE_FILES = 1000;
const WORK_SITE_UPLOAD_CONCURRENCY = 8;
const IMMUTABLE_PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";
const OPEN_READ_NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

class WorkPublishAssetError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

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
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".pdf": "application/pdf",
  ".exe": "application/x-msdownload",
  ".dmg": "application/x-apple-diskimage",
  ".deb": "application/vnd.debian.binary-package",
  ".rpm": "application/x-rpm",
};

type WorkSiteFile = {
  relativePath: string;
  content: Buffer;
  mimeType: string | null;
};

let s3Client: S3Client | null = null;

function getStorage() {
  return {
    endpoint: config.publicAssetOssEndpoint,
    region: config.publicAssetOssRegion,
    bucket: config.publicAssetOssBucket,
    accessKeyId: config.publicAssetOssAccessKeyId,
    secretAccessKey: config.publicAssetOssSecretAccessKey,
  };
}

function requireStorage() {
  const storage = getStorage();
  if (!storage.bucket || !storage.endpoint || !storage.accessKeyId || !storage.secretAccessKey) {
    throw new WorkPublishAssetError(500, "work asset storage is not configured");
  }
  return {
    ...storage,
    bucket: storage.bucket,
    endpoint: storage.endpoint,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  };
}

function getS3Client() {
  const storage = requireStorage();
  s3Client ??= new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    forcePathStyle: false,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
  return s3Client;
}

const cacheBuster = () => randomUUID().replaceAll("-", "").slice(0, 12);
const envPrefix = () => (config.env === "prod" ? "" : `${config.env}/`);
const buildWorkAssetPrefix = (input: { spaceId: string; workSlug: string }) => `${envPrefix()}w/${input.spaceId}/${input.workSlug}/${cacheBuster()}`;
const buildWorkAssetObjectKey = (input: { spaceId: string; workSlug: string }) => `${buildWorkAssetPrefix(input)}/index.html`;

function getMimeType(path: string) {
  const lower = basename(path).toLowerCase();
  if (lower === "dockerfile") return "text/x-dockerfile";
  if (lower === "makefile") return "text/x-makefile";
  return mimeByExt[extname(lower)] ?? (lower.startsWith(".") ? "text/plain" : null);
}

function assertSafeRelativePath(input: string, options?: { allowEmpty?: boolean }) {
  const value = String(input ?? "").replace(/\\/g, "/").trim();
  if (!value) {
    if (options?.allowEmpty) return "";
    throw new WorkPublishAssetError(400, "invalid path", "path_invalid");
  }
  if (value.startsWith("/") || value.includes("\0")) throw new WorkPublishAssetError(400, "invalid path", "path_invalid");
  return value;
}

function assertInsideRoot(target: string, root: string) {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new WorkPublishAssetError(400, "invalid path", "path_invalid");
}

async function resolveTarget(spaceId: string, inputPath: string, options?: { allowEmpty?: boolean }) {
  if (!config.spaceStorageRoot) throw new WorkPublishAssetError(503, "Space file storage is not configured.", "space_storage_not_configured");
  const safePath = assertSafeRelativePath(inputPath, { allowEmpty: options?.allowEmpty });
  const root = await realpath(resolve(config.spaceStorageRoot, spaceId, "workspace")).catch(() => {
    throw new WorkPublishAssetError(404, "space directory not found", "space_not_found");
  });
  const target = resolve(root, safePath);
  assertInsideRoot(target, root);
  return { root, target, relativePath: safePath };
}

async function openVerifiedFile(path: string, root: string) {
  const realPath = await realpath(path).catch(() => {
    throw new WorkPublishAssetError(404, "File or directory not found.", "path_not_found");
  });
  assertInsideRoot(realPath, root);
  return open(realPath, OPEN_READ_NOFOLLOW).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP") {
      throw new WorkPublishAssetError(400, "Symlink export is not supported.", "symlink_not_supported");
    }
    throw error;
  });
}

async function readWorkHtmlFile(spaceId: string, path: string) {
  const { root, target } = await resolveTarget(spaceId, path);
  const pathStats = await lstat(target).catch(() => {
    throw new WorkPublishAssetError(404, "file not found", "path_not_found");
  });
  if (pathStats.isSymbolicLink()) throw new WorkPublishAssetError(400, "Symlink preview is not supported.", "symlink_not_supported");
  if (!pathStats.isFile()) throw new WorkPublishAssetError(400, "The selected path is not a file.", "not_a_file");

  const handle = await openVerifiedFile(target, root);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new WorkPublishAssetError(400, "The selected path is not a file.", "not_a_file");
    if (stats.size <= 0 || stats.size > MAX_WORK_ASSET_BYTES) throw new WorkPublishAssetError(400, "work asset must be 1 byte to 5MB");
    return (await handle.readFile()).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readWorkDirectoryFiles(spaceId: string, path: string) {
  const { root, target, relativePath } = await resolveTarget(spaceId, path, { allowEmpty: true });
  const targetStats = await lstat(target).catch(() => {
    throw new WorkPublishAssetError(404, "File or directory not found.", "path_not_found");
  });
  if (targetStats.isSymbolicLink()) throw new WorkPublishAssetError(400, "Symlink export is not supported.", "symlink_not_supported");
  if (!targetStats.isDirectory()) throw new WorkPublishAssetError(400, "The selected path is not a directory.", "not_a_directory");
  const realTarget = await realpath(target).catch(() => {
    throw new WorkPublishAssetError(404, "File or directory not found.", "path_not_found");
  });
  assertInsideRoot(realTarget, root);

  const files: WorkSiteFile[] = [];
  let totalBytes = 0;

  async function walk(dir: string) {
    const names = await readdir(dir);
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const absPath = resolve(dir, name);
      assertInsideRoot(absPath, root);
      const pathStats = await lstat(absPath);
      if (pathStats.isSymbolicLink()) throw new WorkPublishAssetError(400, "Symlink export is not supported.", "symlink_not_supported");
      if (pathStats.isDirectory()) {
        const realDir = await realpath(absPath);
        assertInsideRoot(realDir, root);
        assertInsideRoot(realDir, realTarget);
        await walk(realDir);
        continue;
      }
      if (!pathStats.isFile()) continue;
      if (files.length >= MAX_WORK_SITE_FILES) {
        throw new WorkPublishAssetError(413, `Cannot publish more than ${MAX_WORK_SITE_FILES} files from a directory.`, "directory_too_many_files");
      }

      const handle = await openVerifiedFile(absPath, root);
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw new WorkPublishAssetError(400, "The selected path is not a file.", "not_a_file");
        totalBytes += stats.size;
        if (totalBytes > MAX_WORK_SITE_BYTES) throw new WorkPublishAssetError(413, "Directory publish size exceeds 100MB.", "directory_too_large");
        files.push({
          relativePath: relative(realTarget, absPath).replace(/\\/g, "/"),
          content: await handle.readFile(),
          mimeType: getMimeType(absPath),
        });
      } finally {
        await handle.close();
      }
    }
  }

  await walk(realTarget);
  return { path: relativePath, files };
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, mapper: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
}

async function putWorkAssetObject(input: { objectKey: string; body: Buffer | string; contentType: string; sha256: string }) {
  await getS3Client().send(new PutObjectCommand({
    Bucket: requireStorage().bucket,
    Key: input.objectKey,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: IMMUTABLE_PUBLIC_CACHE_CONTROL,
    Metadata: { sha256: input.sha256 },
  }));
}

async function writeWorkHtmlAsset(input: { spaceId: string; workSlug: string; html: string }) {
  const sizeBytes = Buffer.byteLength(input.html, "utf8");
  if (sizeBytes <= 0 || sizeBytes > MAX_WORK_ASSET_BYTES) throw new WorkPublishAssetError(400, "work asset must be 1 byte to 5MB");
  const objectKey = buildWorkAssetObjectKey({ spaceId: input.spaceId, workSlug: input.workSlug });
  await putWorkAssetObject({
    objectKey,
    body: input.html,
    contentType: "text/html; charset=utf-8",
    sha256: createHash("sha256").update(input.html).digest("hex"),
  });
  return { assetKey: objectKey, sizeBytes };
}

async function writeWorkSiteAssets(input: { spaceId: string; workSlug: string; files: WorkSiteFile[] }) {
  if (input.files.length <= 0 || input.files.length > MAX_WORK_SITE_FILES) {
    throw new WorkPublishAssetError(400, `work site must contain 1 to ${MAX_WORK_SITE_FILES} files`);
  }
  if (!input.files.some((file) => file.relativePath === "index.html")) {
    throw new WorkPublishAssetError(400, "work site must contain index.html");
  }
  const totalBytes = input.files.reduce((sum, file) => sum + file.content.byteLength, 0);
  if (totalBytes <= 0 || totalBytes > MAX_WORK_SITE_BYTES) throw new WorkPublishAssetError(400, "work site must be 1 byte to 100MB");

  const prefix = buildWorkAssetPrefix({ spaceId: input.spaceId, workSlug: input.workSlug });
  await mapWithConcurrency(input.files, WORK_SITE_UPLOAD_CONCURRENCY, async (file) => {
    const objectKey = `${prefix}/${file.relativePath}`;
    await putWorkAssetObject({
      objectKey,
      body: file.content,
      contentType: file.mimeType ?? "application/octet-stream",
      sha256: createHash("sha256").update(file.content).digest("hex"),
    });
  });

  return {
    assetKey: `${prefix}/index.html`,
    sizeBytes: totalBytes,
    fileCount: input.files.length,
  };
}

async function processWorkPublishAsset(job: Job<WorkPublishAssetJobData>): Promise<WorkPublishAssetJobResult> {
  const { spaceId, slug, targetType, targetRef } = job.data;
  if (targetType === "file") {
    const html = await readWorkHtmlFile(spaceId, targetRef);
    const written = await writeWorkHtmlAsset({ spaceId, workSlug: slug, html });
    return { ok: true, ...written };
  }
  if (targetType === "directory") {
    const result = await readWorkDirectoryFiles(spaceId, targetRef);
    const written = await writeWorkSiteAssets({ spaceId, workSlug: slug, files: result.files });
    return { ok: true, ...written };
  }
  throw new WorkPublishAssetError(400, "target is invalid");
}

registerSystemJob(WORK_PUBLISH_ASSET_JOB, async (job: Job<WorkPublishAssetJobData>) => {
  try {
    return await processWorkPublishAsset(job);
  } catch (error) {
    if (error instanceof WorkPublishAssetError) {
      return { ok: false, status: error.status, message: error.message, code: error.code };
    }
    throw error;
  }
});
