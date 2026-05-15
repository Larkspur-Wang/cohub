import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SpaceFsUploadProgress } from "@cohub/protocol/fs";
import { config } from "../config.js";
import { getSpaceWorkspaceDir, ensureSpaceWorkspaceReady } from "../git.js";
import { publishSpaceFsChanged } from "../space-events.js";
import { registerTask } from "./registry.js";

type ImportEntry = {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string | null;
  objectKey: string;
};

type ImportPayload = {
  uploadId: string;
  spaceId: string;
  targetDir: string;
  entries: ImportEntry[];
};

let s3Client: S3Client | null = null;
const getS3Client = () => {
  if (!config.turnObjectS3Bucket) throw new Error("TURN_OBJECT_S3_BUCKET is required");
  if (!config.turnObjectS3Endpoint) throw new Error("TURN_OBJECT_S3_ENDPOINT is required");
  if (!config.turnObjectS3AccessKeyId || !config.turnObjectS3SecretAccessKey) {
    throw new Error("TURN_OBJECT_S3_ACCESS_KEY_ID and TURN_OBJECT_S3_SECRET_ACCESS_KEY are required");
  }
  s3Client ??= new S3Client({
    endpoint: config.turnObjectS3Endpoint,
    region: config.turnObjectS3Region,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.turnObjectS3AccessKeyId,
      secretAccessKey: config.turnObjectS3SecretAccessKey,
    },
  });
  return s3Client;
};

const assertInsideRoot = (target: string, root: string) => {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error("Invalid upload path.");
};

const safeRelative = (value: string) => {
  const normalized = String(value ?? "").replace(/\\/g, "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) throw new Error("Invalid upload path.");
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid upload path.");
  return parts.join("/");
};

const getParentDirPaths = (path: string) => {
  const parts = path.split("/").slice(0, -1);
  const dirs: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    dirs.push(parts.slice(0, index + 1).join("/"));
  }
  return dirs;
};

const makeTempPath = (finalPath: string, uploadId: string, entryId: string) => {
  const name = basename(finalPath);
  return resolve(dirname(finalPath), `.${name}.cohub-upload-${uploadId}-${entryId}.tmp`);
};

const enforceByteLimit = (maxBytes: number) => {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > maxBytes) {
        callback(new Error("Uploaded object exceeds declared size."));
        return;
      }
      callback(null, chunk);
    },
  });
};

registerTask("import_space_upload", async (job) => {
  const payload = (job.data as { data?: ImportPayload }).data;
  if (!payload?.spaceId || !payload.uploadId || !Array.isArray(payload.entries)) {
    throw new Error("Invalid import_space_upload payload");
  }

  await ensureSpaceWorkspaceReady(payload.spaceId);
  const workspaceDir = resolve(getSpaceWorkspaceDir(payload.spaceId));
  const targetDir = payload.targetDir ? safeRelative(payload.targetDir) : "";
  const totalFiles = payload.entries.length;
  const totalBytes = payload.entries.reduce((sum, entry) => sum + entry.size, 0);
  const uploaded: Array<{ path: string; name: string; size: number; mimeType: string | null; mtimeMs: number }> = [];
  const createdDirs = new Map<string, number>();
  const errors: Array<{ name: string; code: "write_failed" | "object_missing" | "path_invalid"; message: string }> = [];
  let importedBytes = 0;

  const update = async (currentPath?: string) => {
    const progress: SpaceFsUploadProgress = {
      phase: "importing",
      totalFiles,
      importedFiles: uploaded.length,
      totalBytes,
      importedBytes,
      currentPath,
      errors,
    };
    await job.updateProgress(progress);
  };

  await update();

  for (const entry of payload.entries) {
    let finalRelativePath = "";
    try {
      const relPath = safeRelative(entry.relativePath);
      finalRelativePath = targetDir ? `${targetDir}/${relPath}` : relPath;
      const finalPath = resolve(workspaceDir, finalRelativePath);
      assertInsideRoot(finalPath, workspaceDir);
      await mkdir(dirname(finalPath), { recursive: true });
      for (const dirPath of getParentDirPaths(finalRelativePath)) {
        createdDirs.set(dirPath, Date.now());
      }
      const tempPath = makeTempPath(finalPath, payload.uploadId, entry.id);
      await rm(tempPath, { force: true }).catch(() => undefined);

      await update(finalRelativePath);
      const object = await getS3Client().send(new GetObjectCommand({
        Bucket: config.turnObjectS3Bucket,
        Key: entry.objectKey,
      }));
      if (!object.Body) throw new Error("OSS object is empty");
      if (typeof object.ContentLength === "number" && object.ContentLength > entry.size) {
        throw new Error("Uploaded object exceeds declared size.");
      }
      const body = object.Body instanceof Readable
        ? object.Body
        : Readable.fromWeb(object.Body as never);
      try {
        await pipeline(body, enforceByteLimit(entry.size), createWriteStream(tempPath, { flags: "wx" }));
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      const tempInfo = await stat(tempPath);
      if (tempInfo.size !== entry.size) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw new Error("Uploaded object size does not match declared size.");
      }
      await rename(tempPath, finalPath);
      const info = await stat(finalPath);
      importedBytes += info.size;
      uploaded.push({
        path: finalRelativePath,
        name: basename(finalPath),
        size: info.size,
        mimeType: entry.mimeType,
        mtimeMs: info.mtimeMs,
      });
      await getS3Client().send(new DeleteObjectCommand({
        Bucket: config.turnObjectS3Bucket,
        Key: entry.objectKey,
      })).catch(() => undefined);
      await update(finalRelativePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to import file.";
      errors.push({ name: finalRelativePath || entry.relativePath || entry.name, code: message.includes("NoSuchKey") ? "object_missing" : "write_failed", message });
    }
  }

  if (uploaded.length > 0) {
    const dirChanges = Array.from(createdDirs, ([path, mtimeMs]) => ({
      path,
      kind: "create" as const,
      nodeType: "dir" as const,
      mtimeMs,
    }));
    await publishSpaceFsChanged(payload.spaceId, {
      source: "api-fs",
      changes: [
        ...dirChanges,
        ...uploaded.map((file) => ({
          path: file.path,
          kind: "create" as const,
          nodeType: "file" as const,
          size: file.size,
          mtimeMs: file.mtimeMs,
        })),
      ],
    }).catch(console.error);
  }

  const result = { uploaded, errors };
  await job.updateProgress({
    phase: errors.length > 0 ? "failed" : "done",
    totalFiles,
    importedFiles: uploaded.length,
    totalBytes,
    importedBytes,
    errors,
  } satisfies SpaceFsUploadProgress);
  if (errors.length > 0) {
    throw new Error(`Failed to import ${errors.length} of ${totalFiles} file(s).`);
  }
  return result;
});
