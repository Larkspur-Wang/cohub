import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { checkpoints, spaces } from "@cohub/db";
import { createLogger } from "@cohub/infra/logging";
import type { SpaceFsEntry, SpaceFsFileResponse, SpaceFsTreeResponse } from "@cohub/protocol/fs";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { createPresignedGetObjectUrl } from "./object-presign.js";
import { redisCommandClient } from "./redis.js";
import { getMimeType } from "./space-fs.js";

const logger = createLogger({ serviceName: "cohub-api" });

const MAX_DIR_ENTRIES = 1000;
const GIT_TIMEOUT_MS = 3000;
const GIT_TREE_MAX_BYTES = 2 * 1024 * 1024;
const GIT_BLOB_MAX_BYTES = 20 * 1024 * 1024;
const CACHE_TTL_SECONDS = 24 * 60 * 60;
export class CheckpointFsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type CheckpointRecord = typeof checkpoints.$inferSelect;

type GitOutput = {
  stdout: Buffer;
  stderr: string;
};

type AssetPointer = {
  sha256: string;
  size: number;
  mimeType: string | null;
  objectKey: string;
};

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

const cacheKey = (kind: "asset" | "blob" | "tree", checkpointId: string, path: string) =>
  `checkpoint-fs:${kind}:v1:${checkpointId}:${sha256Hex(path)}`;

const normalizeCheckpointPath = (input = "", options: { allowEmpty?: boolean } = {}) => {
  const value = String(input ?? "").replace(/\\/g, "/");
  if (!value) {
    if (options.allowEmpty) return "";
    throw new CheckpointFsError(400, "path_invalid", "Invalid path.");
  }
  if (value.length > 4096 || value.includes("\0") || isAbsolute(value)) {
    throw new CheckpointFsError(400, "path_invalid", "Invalid path.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new CheckpointFsError(400, "path_invalid", "Invalid path.");
  }
  return parts.join("/");
};

const getCheckpointRepoDir = (spaceId: string) => {
  if (!config.spaceSystemRoot) throw new CheckpointFsError(503, "checkpoint_repo_unavailable", "Checkpoint storage is not configured.");
  const root = resolve(config.spaceSystemRoot);
  const target = resolve(root, spaceId, "repo");
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new CheckpointFsError(400, "path_invalid", "Invalid checkpoint path.");
  return target;
};

const truncate = (value: string, max = 2048) => value.length > max ? value.slice(0, max) : value;

const runGit = async (repoDir: string, args: string[], maxBytes: number): Promise<GitOutput> => {
  await access(repoDir).catch(() => {
    throw new CheckpointFsError(503, "checkpoint_repo_unavailable", "Checkpoint repository is unavailable.");
  });

  return await new Promise<GitOutput>((resolvePromise, reject) => {
    const child = spawn("git", ["-c", `safe.directory=${repoDir}`, ...args], {
      cwd: repoDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new CheckpointFsError(504, "checkpoint_fs_timeout", "Checkpoint file operation timed out."));
    }, GIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new CheckpointFsError(413, "checkpoint_blob_too_large", "Checkpoint file is too large."));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = truncate(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        if (stderr) logger.debug("[checkpoint-fs] git command failed", { repoDir, args, stderr });
        reject(new CheckpointFsError(404, "path_not_found", "File or directory not found."));
        return;
      }
      resolvePromise({ stdout: Buffer.concat(chunks), stderr });
    });
  });
};

const gitObjectSpec = (commitHash: string, path: string) => path ? `${commitHash}:${path}` : commitHash;

async function assertGitObjectType(repoDir: string, checkpoint: CheckpointRecord, path: string, expected: "tree" | "blob") {
  if (!path && expected === "tree") return;
  const result = await runGit(repoDir, ["cat-file", "-t", gitObjectSpec(checkpoint.commitHash, path)], 1024).catch((error) => {
    if (error instanceof CheckpointFsError && error.code === "path_not_found") {
      throw new CheckpointFsError(404, "path_not_found", "File or directory not found.");
    }
    throw error;
  });
  const type = result.stdout.toString("utf8").trim();
  if (expected === "tree" && type !== "tree") throw new CheckpointFsError(400, "not_a_directory", "The selected path is not a directory.");
  if (expected === "blob" && type !== "blob") throw new CheckpointFsError(400, "not_a_file", "The selected path is not a file.");
}

export async function getCheckpointForSpace(spaceId: string, checkpointId: string) {
  const resolvedCheckpointId = await resolveCheckpointId(spaceId, checkpointId);
  const [checkpoint] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.id, resolvedCheckpointId), eq(checkpoints.spaceId, spaceId)))
    .limit(1);
  if (!checkpoint) throw new CheckpointFsError(404, "checkpoint_not_found", "Checkpoint not found.");
  return checkpoint;
}

async function resolveCheckpointId(spaceId: string, checkpointId: string) {
  if (checkpointId !== "latest") return checkpointId;
  const [space] = await db.select({ headCheckpointId: spaces.headCheckpointId }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space?.headCheckpointId) throw new CheckpointFsError(404, "checkpoint_not_found", "Checkpoint not found.");
  return space.headCheckpointId;
}

function parseLsTree(output: Buffer, dirPath: string, checkpoint: CheckpointRecord): SpaceFsEntry[] {
  const rawEntries = output.toString("utf8").split("\0").filter(Boolean);
  const entries = rawEntries.slice(0, MAX_DIR_ENTRIES).map((raw): SpaceFsEntry | null => {
    const tabIndex = raw.indexOf("\t");
    if (tabIndex < 0) return null;
    const meta = raw.slice(0, tabIndex).trim().split(/\s+/);
    const name = raw.slice(tabIndex + 1);
    const mode = meta[0] ?? "";
    const objectType = meta[1] ?? "";
    const sizeRaw = meta[3] ?? "0";
    const type: SpaceFsEntry["type"] = objectType === "tree" ? "dir" : mode === "120000" ? "symlink" : "file";
    const path = dirPath ? `${dirPath}/${name}` : name;
    const size = type === "dir" ? 0 : Number.parseInt(sizeRaw, 10) || 0;
    return {
      name,
      path,
      type,
      size,
      mimeType: type === "file" ? getMimeType(name) : null,
      mtimeMs: checkpoint.createdAt?.getTime() ?? 0,
    };
  }).filter((entry): entry is SpaceFsEntry => Boolean(entry));

  entries.sort((a, b) => {
    const typeRank = (item: SpaceFsEntry) => item.type === "dir" ? 0 : item.type === "symlink" ? 1 : 2;
    return typeRank(a) - typeRank(b) || a.name.localeCompare(b.name);
  });
  return entries;
}

const encodeCachedBlob = (content: Buffer) => JSON.stringify({ contentBase64: content.toString("base64") });
const decodeCachedBlob = (raw: string | null) => {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { contentBase64?: string };
  return typeof parsed.contentBase64 === "string" ? Buffer.from(parsed.contentBase64, "base64") : null;
};

async function getCachedBlob(repoDir: string, checkpoint: CheckpointRecord, path: string) {
  const key = cacheKey("blob", checkpoint.id, path);
  const cached = await redisCommandClient.get(key).then(decodeCachedBlob).catch(() => null);
  if (cached) return cached;
  const result = await runGit(repoDir, ["show", gitObjectSpec(checkpoint.commitHash, path)], GIT_BLOB_MAX_BYTES);
  await redisCommandClient.set(key, encodeCachedBlob(result.stdout), "EX", CACHE_TTL_SECONDS).catch(() => undefined);
  return result.stdout;
}

function isTextMime(mimeType: string | null) {
  if (!mimeType) return true;
  return mimeType.startsWith("text/") || ["application/json", "application/xml", "application/yaml", "application/toml", "application/sql", "application/x-ndjson"].includes(mimeType);
}

function presignCheckpointAsset(objectKey: string) {
  const signed = createPresignedGetObjectUrl({
    endpoint: config.checkpointAssetOssEndpoint,
    publicEndpoint: config.checkpointAssetOssPublicEndpoint,
    region: config.checkpointAssetOssRegion,
    bucket: config.checkpointAssetOssBucket,
    accessKeyId: config.checkpointAssetOssAccessKeyId,
    secretAccessKey: config.checkpointAssetOssSecretAccessKey,
  }, objectKey);
  return signed;
}

async function readAssetManifestMap(repoDir: string, checkpoint: CheckpointRecord) {
  const manifestPath = ".cohub/system/checkpoint-assets.v1.json";
  const blob = await getCachedBlob(repoDir, checkpoint, manifestPath).catch((error) => {
    logger.debug("[checkpoint-fs] asset manifest is unavailable", { checkpointId: checkpoint.id, error });
    return null;
  });
  if (!blob) return new Map<string, AssetPointer>();
  try {
    const parsed = JSON.parse(blob.toString("utf8")) as { assets?: Array<{ path: string; sha256: string; size: number; mimeType?: string | null; objectKey: string }> };
    return new Map((parsed.assets ?? []).map((asset) => [asset.path, {
      sha256: asset.sha256,
      size: asset.size,
      mimeType: asset.mimeType ?? null,
      objectKey: asset.objectKey,
    }]));
  } catch (error) {
    logger.warn("[checkpoint-fs] failed to parse asset manifest", { checkpointId: checkpoint.id, error });
    throw new CheckpointFsError(500, "checkpoint_asset_manifest_invalid", "Checkpoint asset manifest is invalid.");
  }
}

async function getAssetForPath(repoDir: string, checkpoint: CheckpointRecord, path: string) {
  const key = cacheKey("asset", checkpoint.id, path);
  const cached = await redisCommandClient.get(key).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as AssetPointer | null;
    } catch (error) {
      logger.warn("[checkpoint-fs] ignored invalid asset cache", { key, error });
      await redisCommandClient.del(key).catch(() => undefined);
    }
  }
  const asset = (await readAssetManifestMap(repoDir, checkpoint)).get(path) ?? null;
  await redisCommandClient.set(key, JSON.stringify(asset), "EX", CACHE_TTL_SECONDS).catch(() => undefined);
  return asset;
}

async function getCachedTree(key: string) {
  const cached = await redisCommandClient.get(key).catch(() => null);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as SpaceFsTreeResponse;
  } catch (error) {
    logger.warn("[checkpoint-fs] ignored invalid tree cache", { key, error });
    await redisCommandClient.del(key).catch(() => undefined);
    return null;
  }
}

export async function listCheckpointDirectory(input: { spaceId: string; checkpointId: string; path?: string }): Promise<SpaceFsTreeResponse> {
  const path = normalizeCheckpointPath(input.path, { allowEmpty: true });
  const checkpoint = await getCheckpointForSpace(input.spaceId, input.checkpointId);
  const repoDir = getCheckpointRepoDir(checkpoint.spaceId);
  const key = cacheKey("tree", checkpoint.id, path);
  const cached = await getCachedTree(key);
  if (cached) return cached;

  await assertGitObjectType(repoDir, checkpoint, path, "tree");
  const result = await runGit(repoDir, ["ls-tree", "-z", "-l", gitObjectSpec(checkpoint.commitHash, path)], GIT_TREE_MAX_BYTES);
  const entries = parseLsTree(result.stdout, path, checkpoint);
  const assets = await readAssetManifestMap(repoDir, checkpoint);
  const merged = entries.map((entry) => {
    const asset = entry.type === "file" ? assets.get(entry.path) : null;
    return asset ? { ...entry, size: asset.size, mimeType: asset.mimeType ?? getMimeType(entry.name) } : entry;
  });
  const response = { path, entries: merged };
  await redisCommandClient.set(key, JSON.stringify(response), "EX", CACHE_TTL_SECONDS).catch(() => undefined);
  return response;
}

export async function readCheckpointFile(input: { spaceId: string; checkpointId: string; path?: string }): Promise<SpaceFsFileResponse> {
  const path = normalizeCheckpointPath(input.path, { allowEmpty: false });
  const checkpoint = await getCheckpointForSpace(input.spaceId, input.checkpointId);
  const repoDir = getCheckpointRepoDir(checkpoint.spaceId);
  await assertGitObjectType(repoDir, checkpoint, path, "blob");
  const mimeType = getMimeType(path);
  const asset = await getAssetForPath(repoDir, checkpoint, path);
  if (asset) {
    const signed = presignCheckpointAsset(asset.objectKey);
    return {
      path,
      name: basename(path),
      size: asset.size,
      mimeType: asset.mimeType ?? mimeType,
      mtimeMs: checkpoint.createdAt?.getTime() ?? 0,
      kind: "binary",
      encoding: "base64",
      content: "",
      delivery: "url",
      url: signed.downloadUrl,
    };
  }
  const blob = await getCachedBlob(repoDir, checkpoint, path);
  const kind = isTextMime(mimeType) ? "text" : "binary";
  return {
    path,
    name: basename(path),
    size: blob.length,
    mimeType,
    mtimeMs: checkpoint.createdAt?.getTime() ?? 0,
    kind,
    encoding: kind === "text" ? "utf-8" : "base64",
    content: kind === "text" ? blob.toString("utf8") : blob.toString("base64"),
    delivery: "inline",
  };
}

export function checkpointFsJsonError(error: unknown) {
  if (error instanceof CheckpointFsError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : "Checkpoint file operation failed.";
  return { status: 500, body: { code: "checkpoint_fs_error", message } };
}
