import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { config } from "./config.js";
import type {
  RuntimeFsEntry,
  RuntimeFsFileResponse,
  RuntimeFsMoveInput,
  RuntimeFsTreeResponse,
  RuntimeFsWriteFileInput,
} from "@cohub/protocol";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DIR_ENTRIES = 1000;

export class RuntimeFsError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
};

function getMimeType(path: string) {
  const lower = basename(path).toLowerCase();
  if (lower === "dockerfile") return "text/x-dockerfile";
  if (lower === "makefile") return "text/x-makefile";
  if (lower.startsWith(".env")) return "text/plain";
  return mimeByExt[extname(lower)] ?? null;
}

function isTextMime(mimeType: string | null, path: string) {
  if (!mimeType) {
    const lower = basename(path).toLowerCase();
    return ["dockerfile", "makefile", "license", "readme"].includes(lower) || lower.startsWith(".env");
  }
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml" ||
    mimeType === "application/toml" ||
    mimeType === "application/sql" ||
    mimeType === "application/x-ndjson"
  );
}

function ensureStorageConfigured() {
  if (!config.runtimeStorageRoot) {
    throw new RuntimeFsError(
      503,
      "runtime_storage_not_configured",
      "Runtime file storage is not configured.",
    );
  }
}

function getWorkspaceRoot(runtimeId: string) {
  ensureStorageConfigured();
  // API deployment mounts only the current environment subPath here, so avoid
  // joining cohub-${ENV} again. This keeps dev/prod isolated by K8s subPath.
  return resolve(config.runtimeStorageRoot, runtimeId, "workspace");
}

function assertSafeRelativePath(input: string, options?: { allowEmpty?: boolean }) {
  const value = String(input ?? "").replace(/\\/g, "/").trim();
  if (!value) {
    if (options?.allowEmpty) return "";
    throw new RuntimeFsError(400, "path_invalid", "Invalid path.");
  }
  if (value.startsWith("/") || value.includes("\0")) {
    throw new RuntimeFsError(400, "path_invalid", "Invalid path.");
  }
  return value;
}

async function resolveWorkspaceRealRoot(runtimeId: string) {
  const root = getWorkspaceRoot(runtimeId);
  try {
    const rootReal = await realpath(root);
    return { root, rootReal };
  } catch {
    throw new RuntimeFsError(
      404,
      "workspace_not_found",
      "Workspace directory not found for this runtime.",
    );
  }
}

function assertInsideRoot(target: string, root: string) {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return;
  }
  throw new RuntimeFsError(400, "path_invalid", "Invalid path.");
}

async function resolveTarget(runtimeId: string, inputPath: string, options?: { allowEmpty?: boolean }) {
  const safePath = assertSafeRelativePath(inputPath, { allowEmpty: options?.allowEmpty });
  const { rootReal } = await resolveWorkspaceRealRoot(runtimeId);
  const target = resolve(rootReal, safePath);
  assertInsideRoot(target, rootReal);
  return { root: rootReal, target, relativePath: safePath };
}

function toRelativePath(root: string, absPath: string) {
  return relative(root, absPath).replace(/\\/g, "/");
}

function entryType(stats: Awaited<ReturnType<typeof lstat>>): RuntimeFsEntry["type"] {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "dir";
  return "file";
}

async function toEntry(root: string, absPath: string, name: string): Promise<RuntimeFsEntry> {
  const stats = await lstat(absPath);
  const type = entryType(stats);
  return {
    name,
    path: toRelativePath(root, absPath),
    type,
    size: stats.size,
    mimeType: type === "file" ? getMimeType(name) : null,
    mtimeMs: stats.mtimeMs,
  };
}

export async function listRuntimeDirectory(runtimeId: string, path = ""): Promise<RuntimeFsTreeResponse> {
  const { root, target, relativePath } = await resolveTarget(runtimeId, path, { allowEmpty: true });
  let targetStats;
  try {
    targetStats = await lstat(target);
  } catch {
    throw new RuntimeFsError(404, "path_not_found", "File or directory not found.");
  }
  if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
    throw new RuntimeFsError(400, "not_a_directory", "The selected path is not a directory.");
  }

  const names = await readdir(target);
  const limitedNames = names.slice(0, MAX_DIR_ENTRIES);
  const entries = await Promise.all(
    limitedNames.map((name) => toEntry(root, join(target, name), name)),
  );

  entries.sort((a, b) => {
    const typeRank = (item: RuntimeFsEntry) => item.type === "dir" ? 0 : item.type === "symlink" ? 1 : 2;
    return typeRank(a) - typeRank(b) || a.name.localeCompare(b.name);
  });

  return { path: relativePath, entries };
}

export async function readRuntimeFile(runtimeId: string, path: string): Promise<RuntimeFsFileResponse> {
  const { target, relativePath } = await resolveTarget(runtimeId, path);
  let stats;
  try {
    stats = await lstat(target);
  } catch {
    throw new RuntimeFsError(404, "path_not_found", "File or directory not found.");
  }
  if (stats.isSymbolicLink()) {
    throw new RuntimeFsError(400, "symlink_not_supported", "Symlink preview is not supported.");
  }
  if (!stats.isFile()) {
    throw new RuntimeFsError(400, "not_a_file", "The selected path is not a file.");
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new RuntimeFsError(
      413,
      "file_too_large",
      "This file is larger than 10MB and cannot be opened in the web viewer.",
    );
  }

  const buffer = await readFile(target);
  const mimeType = getMimeType(target);
  const kind = isTextMime(mimeType, target) ? "text" : "binary";
  return {
    path: relativePath,
    name: basename(target),
    size: stats.size,
    mimeType,
    mtimeMs: stats.mtimeMs,
    kind,
    encoding: kind === "text" ? "utf-8" : "base64",
    content: kind === "text" ? buffer.toString("utf8") : buffer.toString("base64"),
  };
}

export async function writeRuntimeFile(runtimeId: string, input: RuntimeFsWriteFileInput) {
  const { target, relativePath } = await resolveTarget(runtimeId, input.path);
  if (input.encoding !== "utf-8" && input.encoding !== "base64") {
    throw new RuntimeFsError(400, "encoding_invalid", "Invalid file encoding.");
  }

  const content = input.encoding === "base64"
    ? Buffer.from(input.content ?? "", "base64")
    : Buffer.from(input.content ?? "", "utf8");
  if (content.byteLength > MAX_FILE_BYTES) {
    throw new RuntimeFsError(413, "file_too_large", "This file is larger than 10MB and cannot be saved in the web editor.");
  }

  await mkdir(dirname(target), { recursive: true });

  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink() || existing.isDirectory()) {
      throw new RuntimeFsError(400, "not_a_file", "The selected path is not a writable file.");
    }
  } catch (error) {
    if (error instanceof RuntimeFsError) throw error;
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const tmp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  await writeFile(tmp, content, { mode: 0o644 });
  await rename(tmp, target);
  const nextStats = await stat(target);
  return { ok: true as const, path: relativePath, size: nextStats.size, mtimeMs: nextStats.mtimeMs };
}

export async function createRuntimeDirectory(runtimeId: string, path: string) {
  const { target, relativePath } = await resolveTarget(runtimeId, path);
  await mkdir(target, { recursive: true });
  const stats = await stat(target);
  return { ok: true as const, path: relativePath, size: stats.size, mtimeMs: stats.mtimeMs };
}

export async function deleteRuntimeNode(runtimeId: string, path: string, recursive = false) {
  const { target, relativePath } = await resolveTarget(runtimeId, path);
  try {
    await rm(target, { recursive, force: false });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      throw new RuntimeFsError(404, "path_not_found", "File or directory not found.");
    }
    throw error;
  }
  return { ok: true as const, path: relativePath };
}

export async function moveRuntimeNode(runtimeId: string, input: RuntimeFsMoveInput) {
  const from = await resolveTarget(runtimeId, input.fromPath);
  const to = await resolveTarget(runtimeId, input.toPath);

  try {
    await access(from.target, constants.F_OK);
  } catch {
    throw new RuntimeFsError(404, "path_not_found", "File or directory not found.");
  }

  await mkdir(dirname(to.target), { recursive: true });

  const lock = `${to.target}.cohub-move-lock-${randomUUID()}`;
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    lockHandle = await open(lock, "wx");
    try {
      await access(to.target, constants.F_OK);
      throw new RuntimeFsError(409, "path_conflict", "A file or directory already exists at the target path.");
    } catch (error) {
      if (error instanceof RuntimeFsError) throw error;
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    try {
      await rename(from.target, to.target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") {
        throw new RuntimeFsError(404, "path_not_found", "File or directory not found.");
      }
      if (code === "EEXIST") {
        throw new RuntimeFsError(409, "path_conflict", "A file or directory already exists at the target path.");
      }
      throw error;
    }
  } finally {
    await lockHandle?.close().catch(() => undefined);
    await rm(lock, { force: true }).catch(() => undefined);
  }

  return { ok: true as const, fromPath: from.relativePath, toPath: to.relativePath };
}

export function runtimeFsJsonError(error: unknown) {
  if (error instanceof RuntimeFsError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : "Runtime file operation failed.";
  return { status: 500, body: { code: "runtime_fs_error", message } };
}
