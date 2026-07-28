import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  collectLocalPageAssetRefs,
  extractHtmlPageMeta,
  fillIconFromSiteFiles,
  normalizeLocalPageAssetRef,
} from "@cohub/core/works";
import {
  BOARD_EXTENSION,
  BOARD_MIME_TYPE,
  isBoardPath,
  parseBoardManifest,
  type BoardSnapshot,
  type WorkBoardArtifactManifest,
  type WorkBoardAsset,
} from "@cohub/protocol";
import type { Job } from "bullmq";
import { captureBoardSnapshots } from "../../../checkpoint/board-snapshot.js";
import { config } from "../../../config.js";
import { registerSystemJob } from "../../registry.js";
import {
  WORK_PUBLISH_ASSET_JOB,
  type WorkPublishAssetJobData,
  type WorkPublishAssetJobResult,
  type WorkPublishExtractedPageMeta,
} from "./types.js";

const MAX_WORK_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_WORK_SITE_BYTES = 100 * 1024 * 1024;
const MAX_WORK_SITE_FILES = 1000;
/** Companion icon/image files packed next to a single-file HTML publish. */
const MAX_WORK_PAGE_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_WORK_PAGE_ASSET_FILES = 8;
const WORK_SITE_UPLOAD_CONCURRENCY = 8;
const IMMUTABLE_PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable";
const OPEN_READ_NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const PAGE_ASSET_EXT = new Set([
  ".ico",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
]);

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
  [BOARD_EXTENSION]: BOARD_MIME_TYPE,
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
    const html = (await handle.readFile()).toString("utf8");
    const htmlDir = await realpath(resolve(target, "..")).catch(() => null);
    if (!htmlDir) return { html, companions: [] as WorkSiteFile[] };
    assertInsideRoot(htmlDir, root);
    const companions = await readWorkPageCompanionAssets({
      root,
      htmlDir,
      html,
    });
    return { html, companions };
  } finally {
    await handle.close();
  }
}

async function readWorkFile(spaceId: string, path: string) {
  const { root, target, relativePath } = await resolveTarget(spaceId, path);
  const pathStats = await lstat(target).catch(() => {
    throw new WorkPublishAssetError(404, "file not found", "path_not_found");
  });
  if (pathStats.isSymbolicLink()) throw new WorkPublishAssetError(400, "Symlink preview is not supported.", "symlink_not_supported");
  if (!pathStats.isFile()) throw new WorkPublishAssetError(400, "The selected path is not a file.", "not_a_file");

  const handle = await openVerifiedFile(target, root);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new WorkPublishAssetError(400, "The selected path is not a file.", "not_a_file");
    if (stats.size > MAX_WORK_SITE_BYTES) throw new WorkPublishAssetError(413, "File publish size exceeds 100MB.", "file_too_large");
    return {
      root,
      relativePath,
      name: basename(relativePath),
      mimeType: getMimeType(relativePath),
      content: await handle.readFile(),
    };
  } finally {
    await handle.close();
  }
}

async function readOptionalWorkspaceFile(input: {
  root: string;
  absPath: string;
  maxBytes: number;
}): Promise<Buffer | null> {
  const pathStats = await lstat(input.absPath).catch(() => null);
  if (!pathStats || pathStats.isSymbolicLink() || !pathStats.isFile()) return null;
  if (pathStats.size <= 0 || pathStats.size > input.maxBytes) return null;
  const handle = await openVerifiedFile(input.absPath, input.root).catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size > input.maxBytes) return null;
    return handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Pack local icon/image refs next to a single HTML file so shell/OG URLs resolve on CDN.
 * Missing companions are skipped; publish still succeeds with title/description.
 */
async function readWorkPageCompanionAssets(input: {
  root: string;
  htmlDir: string;
  html: string;
}): Promise<WorkSiteFile[]> {
  const page = extractHtmlPageMeta(input.html);
  const candidates = collectLocalPageAssetRefs(page);
  const files: WorkSiteFile[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (files.length >= MAX_WORK_PAGE_ASSET_FILES) break;
    const relativePath = normalizeLocalPageAssetRef(candidate);
    if (!relativePath) continue;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const ext = extname(relativePath).toLowerCase();
    if (!PAGE_ASSET_EXT.has(ext)) continue;

    const absPath = resolve(input.htmlDir, relativePath);
    // Keep companions next to the HTML entry (same publish prefix layout).
    const relToHtmlDir = relative(input.htmlDir, absPath).replace(/\\/g, "/");
    if (
      !relToHtmlDir ||
      relToHtmlDir.startsWith("../") ||
      isAbsolute(relToHtmlDir) ||
      relToHtmlDir.includes("\0")
    ) {
      continue;
    }
    try {
      assertInsideRoot(absPath, input.root);
      assertInsideRoot(absPath, input.htmlDir);
    } catch {
      continue;
    }

    const content = await readOptionalWorkspaceFile({
      root: input.root,
      absPath,
      maxBytes: MAX_WORK_PAGE_ASSET_BYTES,
    });
    if (!content) continue;
    files.push({
      relativePath: relToHtmlDir,
      content,
      mimeType: getMimeType(relToHtmlDir),
    });
  }

  return files;
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

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function normalizeSitePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

function keepSiteAssetRef(ref: string | null, available: Set<string>): string | null {
  if (!ref) return null;
  // Inline icons and absolute URLs are fine for any target type.
  if (/^data:image\//i.test(ref)) return ref;
  if (isAbsoluteHttpUrl(ref) || ref.startsWith("//")) return ref;
  const cleaned = ref.replace(/^\.\//, "").replace(/^\/+/, "");
  // Relative assets only survive when the publish uploaded that file
  // (directory sites / companions). Missing siblings stay null — do not invent URLs.
  return available.has(normalizeSitePath(cleaned)) ? cleaned : null;
}

function extractPageMetaFromHtml(
  html: string,
  sourcePath: string,
  relativePaths: Iterable<string> = [],
): WorkPublishExtractedPageMeta {
  const paths = Array.from(relativePaths);
  const available = new Set(paths.map((path) => normalizeSitePath(path)));
  const page = fillIconFromSiteFiles(extractHtmlPageMeta(html), paths);
  return {
    title: page.title,
    description: page.description,
    icon: keepSiteAssetRef(page.icon, available),
    image: keepSiteAssetRef(page.image, available),
    lang: page.lang,
    themeColor: page.themeColor,
    sourcePath,
  };
}

async function writeWorkHtmlAsset(input: {
  spaceId: string;
  workSlug: string;
  html: string;
  companions?: WorkSiteFile[];
}) {
  const htmlBytes = Buffer.byteLength(input.html, "utf8");
  if (htmlBytes <= 0 || htmlBytes > MAX_WORK_ASSET_BYTES) throw new WorkPublishAssetError(400, "work asset must be 1 byte to 5MB");
  const companions = input.companions ?? [];
  const companionBytes = companions.reduce((sum, file) => sum + file.content.byteLength, 0);
  const sizeBytes = htmlBytes + companionBytes;
  if (sizeBytes > MAX_WORK_ASSET_BYTES + MAX_WORK_PAGE_ASSET_BYTES * MAX_WORK_PAGE_ASSET_FILES) {
    throw new WorkPublishAssetError(400, "work asset is too large");
  }

  const prefix = buildWorkAssetPrefix({ spaceId: input.spaceId, workSlug: input.workSlug });
  const objectKey = `${prefix}/index.html`;
  await putWorkAssetObject({
    objectKey,
    body: input.html,
    contentType: "text/html; charset=utf-8",
    sha256: createHash("sha256").update(input.html).digest("hex"),
  });
  await mapWithConcurrency(companions, WORK_SITE_UPLOAD_CONCURRENCY, async (file) => {
    await putWorkAssetObject({
      objectKey: `${prefix}/${file.relativePath}`,
      body: file.content,
      contentType: file.mimeType ?? "application/octet-stream",
      sha256: createHash("sha256").update(file.content).digest("hex"),
    });
  });

  const uploadedPaths = ["index.html", ...companions.map((file) => file.relativePath)];
  return {
    assetKey: objectKey,
    sizeBytes,
    fileCount: uploadedPaths.length,
    extracted: extractPageMetaFromHtml(input.html, "index.html", uploadedPaths),
  };
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

  const entry = input.files.find((file) => file.relativePath === "index.html");
  const extracted = entry
    ? extractPageMetaFromHtml(
        entry.content.toString("utf8"),
        "index.html",
        input.files.map((file) => file.relativePath),
      )
    : null;

  return {
    assetKey: `${prefix}/index.html`,
    sizeBytes: totalBytes,
    fileCount: input.files.length,
    extracted,
  };
}

async function writeWorkFileAsset(input: {
  spaceId: string;
  workSlug: string;
  file: Awaited<ReturnType<typeof readWorkFile>>;
}) {
  const prefix = buildWorkAssetPrefix({ spaceId: input.spaceId, workSlug: input.workSlug });
  const extension = extname(input.file.name).toLowerCase();
  const objectKey = `${prefix}/content${extension}`;
  const sha256 = createHash("sha256").update(input.file.content).digest("hex");
  await putWorkAssetObject({
    objectKey,
    body: input.file.content,
    contentType: input.file.mimeType ?? "application/octet-stream",
    sha256,
  });
  return {
    assetKey: objectKey,
    sizeBytes: input.file.content.byteLength,
    fileCount: 1,
    extracted: null,
    artifact: {
      kind: "file" as const,
      name: input.file.name,
      mimeType: input.file.mimeType,
      sizeBytes: input.file.content.byteLength,
      sha256,
    },
  };
}

function collectBoardDependencyPaths(snapshot: BoardSnapshot): string[] {
  const paths = new Set<string>();
  for (const node of snapshot.nodes) {
    if ((node.type === "image" || node.type === "video") && node.refPath) {
      paths.add(node.refPath);
    }
    if (node.type === "file" && typeof node.view.coverPath === "string") {
      paths.add(node.view.coverPath);
    }
  }
  for (const owner of [...snapshot.effects, ...snapshot.clips]) {
    for (const ref of owner.assetRefs) {
      if (ref.type === "space-file") paths.add(ref.ref);
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

type CapturedBoardDependency = WorkBoardAsset & {
  content?: Buffer;
};

/**
 * Read one Board dependency, charging its bytes against a shared budget *before*
 * the read.
 *
 * Reserving up front is what bounds memory. With the check after the fact, N
 * concurrent readers could each pull a file up to the per-file cap before
 * anything noticed, so peak memory scaled with the reference count rather than
 * the publish budget. The reservation runs between awaits, so it is atomic.
 */
async function captureBoardDependency(
  root: string,
  sourcePath: string,
  budget: { reserve: (bytes: number) => boolean },
): Promise<CapturedBoardDependency> {
  let absolutePath: string;
  try {
    const safePath = assertSafeRelativePath(sourcePath);
    absolutePath = resolve(root, safePath);
    assertInsideRoot(absolutePath, root);
  } catch {
    return { sourcePath, status: "rejected", reason: "path_invalid" };
  }
  const stats = await lstat(absolutePath).catch(() => null);
  if (!stats) return { sourcePath, status: "missing", reason: "path_not_found" };
  if (stats.isSymbolicLink() || !stats.isFile()) {
    return { sourcePath, status: "rejected", reason: "unsupported_file_type" };
  }
  if (stats.size > MAX_WORK_SITE_BYTES) {
    return { sourcePath, status: "rejected", reason: "asset_too_large" };
  }
  if (!budget.reserve(stats.size)) {
    throw new WorkPublishAssetError(413, "Board asset publish size exceeds 100MB.", "board_assets_too_large");
  }
  const handle = await openVerifiedFile(absolutePath, root).catch(() => null);
  if (!handle) return { sourcePath, status: "missing", reason: "path_not_found" };
  try {
    const verified = await handle.stat();
    if (!verified.isFile()) return { sourcePath, status: "rejected", reason: "unsupported_file_type" };
    const content = await handle.readFile();
    const sha256 = createHash("sha256").update(content).digest("hex");
    const extension = extname(sourcePath).toLowerCase();
    return {
      sourcePath,
      status: "captured",
      artifactPath: `assets/${sha256}${extension}`,
      mimeType: getMimeType(sourcePath),
      sizeBytes: content.byteLength,
      sha256,
      content,
    };
  } finally {
    await handle.close();
  }
}

/** Shared byte budget for one Board publish. */
function createByteBudget(limit: number) {
  let remaining = limit;
  return {
    reserve: (bytes: number) => {
      if (bytes > remaining) return false;
      remaining -= bytes;
      return true;
    },
    /** Give back bytes that turned out to be a duplicate of an already-published blob. */
    release: (bytes: number) => {
      remaining += bytes;
    },
    get used() {
      return limit - remaining;
    },
  };
}

async function writeWorkBoardAsset(input: {
  spaceId: string;
  workSlug: string;
  sourcePath: string;
  root: string;
  content: Buffer;
}) {
  const sourceManifest = (() => {
    try {
      return parseBoardManifest(input.content.toString("utf8"));
    } catch (cause) {
      // A malformed `.board` file is the publisher's input, not a server fault:
      // surface it as an actionable 400 instead of a generic storage failure.
      throw new WorkPublishAssetError(
        400,
        cause instanceof Error ? cause.message : "Board file is invalid",
        "invalid_board_manifest",
      );
    }
  })();
  const [snapshot] = await captureBoardSnapshots({
    spaceId: input.spaceId,
    boardIds: [sourceManifest.boardId],
  });
  if (!snapshot) throw new WorkPublishAssetError(404, "board not found", "board_not_found");

  const dependencyPaths = collectBoardDependencyPaths(snapshot);
  if (dependencyPaths.length > MAX_WORK_SITE_FILES) {
    throw new WorkPublishAssetError(413, `Board references more than ${MAX_WORK_SITE_FILES} assets.`, "board_too_many_assets");
  }

  const prefix = buildWorkAssetPrefix({ spaceId: input.spaceId, workSlug: input.workSlug });
  const budget = createByteBudget(MAX_WORK_SITE_BYTES);
  const uploaded = new Set<string>();
  // Indexed rather than appended: workers finish out of order, and the manifest
  // should still list assets in the board's stable reference order.
  const assets = new Array<WorkBoardAsset>(dependencyPaths.length);

  // Each dependency is read and uploaded by the same worker, so a buffer is
  // released as soon as its bytes are in object storage. Peak memory is bounded
  // by the concurrency, and the total by the publish budget.
  await mapWithConcurrency(
    dependencyPaths.map((sourcePath, index) => ({ sourcePath, index })),
    WORK_SITE_UPLOAD_CONCURRENCY,
    async ({ sourcePath, index }) => {
      const { content, ...asset } = await captureBoardDependency(input.root, sourcePath, budget);
      assets[index] = asset;
      if (!content || !asset.artifactPath || !asset.sha256) return;
      // Content-addressed: identical bytes are stored once, and the duplicate's
      // reservation goes back to the budget.
      if (uploaded.has(asset.artifactPath)) {
        budget.release(content.byteLength);
        return;
      }
      uploaded.add(asset.artifactPath);
      await putWorkAssetObject({
        objectKey: `${prefix}/${asset.artifactPath}`,
        body: content,
        contentType: asset.mimeType ?? "application/octet-stream",
        sha256: asset.sha256,
      });
    },
  );

  const manifest: WorkBoardArtifactManifest = {
    kind: "cohub.work.board",
    version: 1,
    sourcePath: input.sourcePath,
    snapshot,
    assets,
  };
  const body = `${JSON.stringify(manifest)}\n`;
  const objectKey = `${prefix}/board.json`;
  await putWorkAssetObject({
    objectKey,
    body,
    contentType: "application/json; charset=utf-8",
    sha256: createHash("sha256").update(body).digest("hex"),
  });
  const sizeBytes = Buffer.byteLength(body) + budget.used;
  const fileCount = uploaded.size + 1;
  return {
    assetKey: objectKey,
    sizeBytes,
    fileCount,
    extracted: null,
    artifact: {
      kind: "board" as const,
      boardId: snapshot.board.id,
      boardVersion: snapshot.board.version,
      sizeBytes,
      fileCount,
    },
  };
}

async function processWorkPublishAsset(job: Job<WorkPublishAssetJobData>): Promise<WorkPublishAssetJobResult> {
  const { spaceId, slug, targetType, targetRef } = job.data;
  if (targetType === "file") {
    if (/\.html?$/i.test(targetRef)) {
      const { html, companions } = await readWorkHtmlFile(spaceId, targetRef);
      const written = await writeWorkHtmlAsset({ spaceId, workSlug: slug, html, companions });
      return {
        ok: true,
        ...written,
        artifact: {
          kind: "web",
          mimeType: "text/html",
          sizeBytes: written.sizeBytes,
          fileCount: written.fileCount,
        },
      };
    }
    const file = await readWorkFile(spaceId, targetRef);
    const written = isBoardPath(targetRef)
      ? await writeWorkBoardAsset({
          spaceId,
          workSlug: slug,
          sourcePath: file.relativePath,
          root: file.root,
          content: file.content,
        })
      : await writeWorkFileAsset({ spaceId, workSlug: slug, file });
    return { ok: true, ...written };
  }
  if (targetType === "directory") {
    const result = await readWorkDirectoryFiles(spaceId, targetRef);
    const written = await writeWorkSiteAssets({ spaceId, workSlug: slug, files: result.files });
    return {
      ok: true,
      ...written,
      artifact: {
        kind: "web",
        mimeType: "text/html",
        sizeBytes: written.sizeBytes,
        fileCount: written.fileCount,
      },
    };
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
