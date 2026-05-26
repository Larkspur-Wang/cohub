import { open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { createBatchDrizzlePermissionStore, hasPermission } from "@cohub/core/permissions";
import type { GenerationSource } from "@cohub/protocol/generation";
import type { GenerationSourceResolver } from "@cohub/core/generations";
import { GenerationHttpError } from "@cohub/core/generations";
import { db } from "./db.js";
import { config } from "./config.js";

const MAX_SPACE_FILE_BYTES = 10 * 1024 * 1024;

const permissionStore = createBatchDrizzlePermissionStore(db);

const mimeByExt: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

function getMimeType(path: string) {
  return mimeByExt[extname(basename(path)).toLowerCase()] ?? "application/octet-stream";
}

function assertSafeRelativePath(input: string) {
  const value = String(input ?? "").replace(/\\/g, "/").trim();
  if (!value || value.startsWith("/") || value.includes("\0")) {
    throw new GenerationHttpError(400, "path_invalid", "Invalid space file path");
  }
  return value;
}

function assertInsideRoot(rootReal: string, targetReal: string) {
  const rel = relative(rootReal, targetReal);
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new GenerationHttpError(400, "path_invalid", "Invalid space file path");
  }
}

async function resolveSpaceFilePath(spaceId: string, path: string) {
  if (!config.spaceStorageRoot) {
    throw new GenerationHttpError(503, "space_storage_not_configured", "Space file storage is not configured");
  }
  const root = resolve(config.spaceStorageRoot, spaceId, "workspace");
  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    throw new GenerationHttpError(404, "space_not_found", "Space directory not found");
  }
  const target = resolve(rootReal, assertSafeRelativePath(path));
  assertInsideRoot(rootReal, target);
  return { rootReal, target };
}

async function readSpaceFileAsDataUri(spaceId: string, path: string) {
  const { rootReal, target } = await resolveSpaceFilePath(spaceId, path);
  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    throw new GenerationHttpError(404, "path_not_found", "Space file not found");
  }
  assertInsideRoot(rootReal, targetReal);

  const file = await open(targetReal, "r").catch(() => null);
  if (!file) throw new GenerationHttpError(404, "path_not_found", "Space file not found");
  try {
    const stats = await file.stat();
    if (!stats.isFile()) {
      throw new GenerationHttpError(400, "not_a_file", "Space file input must be a regular file");
    }
    if (stats.size > MAX_SPACE_FILE_BYTES) {
      throw new GenerationHttpError(413, "space_file_too_large", "Space file is too large for generation input");
    }
    const data = await file.readFile();
    return `data:${getMimeType(path)};base64,${data.toString("base64")}`;
  } finally {
    await file.close().catch(() => undefined);
  }
}

export const resolveGenerationSource: GenerationSourceResolver = async (source: GenerationSource, user) => {
  switch (source.type) {
    case "url":
      return source.url;
    case "base64":
      return `data:${source.media_type};base64,${source.data}`;
    case "space_file": {
      const allowed = await hasPermission({
        store: permissionStore,
        user,
        permission: "file.view",
        context: { spaceId: source.space_id },
      });
      if (!allowed) throw new GenerationHttpError(403, "space_file_forbidden", "No permission to read space file");
      return readSpaceFileAsDataUri(source.space_id, source.path);
    }
  }
};
