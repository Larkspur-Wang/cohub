import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  CHECKPOINT_HARD_EXCLUDES,
  CHECKPOINT_PLATFORM_IGNORE,
} from "@cohub/core/checkpoint/ignore";
import { eq } from "drizzle-orm";
import { spaces } from "@cohub/db";
import type {
  CheckpointDiffFile,
  CheckpointDiffPatchLine,
  SpacePendingDiffFileResponse,
  SpacePendingDiffSummary,
} from "@cohub/protocol/fs";
import ignore, { type Ignore } from "ignore";
import { config } from "./config.js";
import {
  accumulateStats,
  DIFF_SUMMARY_MAX_FILES,
  emptyStats,
  isAssetPointerContent,
  isSystemPath,
  parseAssetPointer,
} from "./checkpoint-diff.js";
import { CheckpointFsError } from "./checkpoint-fs.js";
import { db } from "./db/index.js";
import { redisCommandClient } from "./redis.js";
import { getSpaceSandboxBySpaceId } from "./space-sandboxes.js";
import { getSpaceRoot } from "./space-fs.js";

// NFS-friendly budgets: pending preview must not hammer the share.
const PENDING_CACHE_TTL_SECONDS = 120;
const PENDING_PATCH_MAX_BYTES = 256 * 1024;
const HASH_COMPARE_MAX_BYTES = 256 * 1024;
const SCAN_FILE_BUDGET = 8_000;
const SCAN_TIME_BUDGET_MS = 2_500;
/** Cap content hashing during compare — NFS-friendly. */
const HASH_COMPARE_MAX_FILES = 64;
const HASH_COMPARE_TOTAL_BYTES = 4 * 1024 * 1024;

type ScannedEntry = {
  path: string;
  absPath: string;
  type: "file" | "symlink";
  size: number;
  mtimeMs: number;
};

type IgnoreMatcher = {
  baseDir: string;
  matcher: Ignore;
};

const systemMatcher = ignore().add([...CHECKPOINT_HARD_EXCLUDES]).add(CHECKPOINT_PLATFORM_IGNORE);

const pathForIgnore = (path: string, isDirectory: boolean) =>
  isDirectory && !path.endsWith("/") ? `${path}/` : path;

async function readGitignore(dir: string): Promise<IgnoreMatcher | null> {
  const content = await readFile(join(dir, ".gitignore"), "utf8").catch(() => null);
  if (!content) return null;
  return { baseDir: dir, matcher: ignore().add(content) };
}

function isIgnoredByMatchers(root: string, absPath: string, isDirectory: boolean, matchers: IgnoreMatcher[]) {
  for (const { baseDir, matcher } of matchers) {
    const rel = relative(baseDir, absPath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("../")) continue;
    if (matcher.ignores(pathForIgnore(rel, isDirectory))) return true;
  }
  // Also evaluate root-relative path against system matcher (already done by caller for root rel).
  void root;
  return false;
}

function shouldExclude(path: string, isDirectory = false) {
  if (isSystemPath(path)) return true;
  return systemMatcher.ignores(pathForIgnore(path, isDirectory));
}

function getLatestDir(spaceId: string) {
  if (!config.checkpointCacheRoot) {
    throw new CheckpointFsError(503, "checkpoint_repo_unavailable", "Checkpoint cache is not configured.");
  }
  const root = resolve(config.checkpointCacheRoot);
  const target = resolve(root, spaceId, "latest");
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel.startsWith("/")) {
    throw new CheckpointFsError(400, "path_invalid", "Invalid checkpoint path.");
  }
  return target;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scanTree(root: string, budget: { files: number; deadline: number; incomplete: boolean }): Promise<Map<string, ScannedEntry>> {
  const result = new Map<string, ScannedEntry>();
  if (!(await pathExists(root))) return result;

  const walk = async (dir: string, relPrefix: string, inherited: IgnoreMatcher[]) => {
    if (budget.incomplete || Date.now() > budget.deadline) {
      budget.incomplete = true;
      return;
    }
    const local = await readGitignore(dir);
    const matchers = local ? [...inherited, local] : inherited;

    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (budget.incomplete || Date.now() > budget.deadline) {
        budget.incomplete = true;
        return;
      }
      // Nested git repos are never part of checkpoint content (worker treats them specially).
      if (name === ".git") continue;

      const absPath = join(dir, name);
      const path = relPrefix ? `${relPrefix}/${name}` : name;
      let st: Awaited<ReturnType<typeof lstat>>;
      try {
        st = await lstat(absPath);
      } catch {
        continue;
      }
      const isDirectory = st.isDirectory() && !st.isSymbolicLink();
      if (shouldExclude(path, isDirectory)) continue;
      if (isIgnoredByMatchers(root, absPath, isDirectory, matchers)) continue;

      if (isDirectory) {
        await walk(absPath, path, matchers);
        continue;
      }
      if (st.isSymbolicLink() || st.isFile()) {
        if (budget.files >= SCAN_FILE_BUDGET) {
          budget.incomplete = true;
          return;
        }
        budget.files += 1;
        result.set(path, {
          path,
          absPath,
          type: st.isSymbolicLink() ? "symlink" : "file",
          size: st.isSymbolicLink() ? 0 : st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
  };

  await walk(root, "", []);
  return result;
}

async function hashFile(absPath: string, maxBytes: number): Promise<string | null> {
  try {
    const st = await stat(absPath);
    if (st.size > maxBytes) return null;
  } catch {
    return null;
  }
  return await new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(absPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function readTextCapped(absPath: string, maxBytes: number): Promise<{ content: string | null; size: number; binary: boolean; tooLarge: boolean }> {
  try {
    const st = await lstat(absPath);
    if (st.isSymbolicLink()) {
      const link = await readlink(absPath);
      return { content: link, size: Buffer.byteLength(link), binary: false, tooLarge: false };
    }
    if (!st.isFile()) return { content: null, size: 0, binary: false, tooLarge: false };
    if (st.size > maxBytes) return { content: null, size: st.size, binary: false, tooLarge: true };
    const buf = await readFile(absPath);
    if (buf.includes(0)) return { content: null, size: buf.length, binary: true, tooLarge: false };
    return { content: buf.toString("utf8"), size: buf.length, binary: false, tooLarge: false };
  } catch {
    return { content: null, size: 0, binary: false, tooLarge: false };
  }
}

function simpleLineDiff(oldText: string, newText: string): { lines: CheckpointDiffPatchLine[]; additions: number; deletions: number } {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  // Drop trailing empty line caused by final newline so diffs stay clean.
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

  // Myers LCS for reasonable sizes; fall back to full replace for huge files.
  if (oldLines.length * newLines.length > 2_000_000) {
    const lines: CheckpointDiffPatchLine[] = [
      { type: "hunk", text: `@@ -1,${oldLines.length} +1,${newLines.length} @@` },
      ...oldLines.map((text) => ({ type: "del" as const, text })),
      ...newLines.map((text) => ({ type: "add" as const, text })),
    ];
    return { lines, additions: newLines.length, deletions: oldLines.length };
  }

  const n = oldLines.length;
  const m = newLines.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] ?? new Uint32Array(m + 1);
    const nextRow = dp[i + 1] ?? new Uint32Array(m + 1);
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = oldLines[i] === newLines[j]
        ? ((nextRow[j + 1] ?? 0) + 1)
        : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
    dp[i] = row;
  }

  const ops: Array<{ type: "context" | "add" | "del"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const oldLine = oldLines[i] ?? "";
    const newLine = newLines[j] ?? "";
    const down = dp[i + 1]?.[j] ?? 0;
    const right = dp[i]?.[j + 1] ?? 0;
    if (oldLine === newLine) {
      ops.push({ type: "context", text: oldLine });
      i += 1;
      j += 1;
    } else if (down >= right) {
      ops.push({ type: "del", text: oldLine });
      i += 1;
    } else {
      ops.push({ type: "add", text: newLine });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: oldLines[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", text: newLines[j] ?? "" });
    j += 1;
  }

  // Collapse into a single hunk for simplicity (still readable, avoids complex hunk splitting).
  const lines: CheckpointDiffPatchLine[] = [
    { type: "hunk", text: `@@ -1,${n} +1,${m} @@` },
    ...ops,
  ];
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "add") additions += 1;
    else if (op.type === "del") deletions += 1;
  }
  return { lines, additions, deletions };
}

async function entriesEqual(
  a: ScannedEntry,
  b: ScannedEntry,
  budget: { deadline: number; incomplete: boolean; hashFiles: number; hashBytes: number },
): Promise<boolean | "timeout"> {
  if (Date.now() > budget.deadline) {
    budget.incomplete = true;
    return "timeout";
  }
  if (a.type !== b.type) return false;
  if (a.type === "symlink") {
    const [la, lb] = await Promise.all([readlink(a.absPath).catch(() => null), readlink(b.absPath).catch(() => null)]);
    return la === lb;
  }
  if (a.size !== b.size) return false;
  // NFS-friendly: size + mtime is enough for a preview.
  if (a.mtimeMs === b.mtimeMs) return true;
  // Optional tiny-file hash — hard-capped so compare phase cannot hammer NAS.
  if (
    a.size > 0 &&
    a.size <= HASH_COMPARE_MAX_BYTES &&
    budget.hashFiles < HASH_COMPARE_MAX_FILES &&
    budget.hashBytes + a.size * 2 <= HASH_COMPARE_TOTAL_BYTES
  ) {
    budget.hashFiles += 1;
    budget.hashBytes += a.size * 2;
    const [ha, hb] = await Promise.all([
      hashFile(a.absPath, HASH_COMPARE_MAX_BYTES),
      hashFile(b.absPath, HASH_COMPARE_MAX_BYTES),
    ]);
    if (ha && hb) return ha === hb;
  }
  // mtime differs and we skip/can't hash → treat as modified (acceptable for preview).
  return false;
}

function cacheKey(spaceId: string, headCheckpointId: string | null) {
  return `checkpoint-pending-diff:v1:${spaceId}:${headCheckpointId ?? "none"}`;
}

export async function getSpacePendingDiffSummary(spaceId: string): Promise<SpacePendingDiffSummary> {
  const [space] = await db
    .select({ headCheckpointId: spaces.headCheckpointId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) throw new CheckpointFsError(404, "space_not_found", "Space not found.");

  const headCheckpointId = space.headCheckpointId ?? null;
  const key = cacheKey(spaceId, headCheckpointId);
  const cachedRaw = await redisCommandClient.get(key).catch(() => null);
  if (cachedRaw) {
    try {
      return JSON.parse(cachedRaw) as SpacePendingDiffSummary;
    } catch {
      await redisCommandClient.del(key).catch(() => undefined);
    }
  }

  // Local sandboxes keep the workspace on the user machine — pending preview is unavailable.
  const sandbox = await getSpaceSandboxBySpaceId(spaceId).catch(() => null);
  if (sandbox?.provider === "local") {
    return {
      baseCheckpointId: headCheckpointId,
      files: [],
      truncated: false,
      incomplete: true,
      stats: emptyStats(),
    };
  }

  const workspaceDir = getSpaceRoot(spaceId);
  const latestDir = getLatestDir(spaceId);
  const budget = {
    files: 0,
    deadline: Date.now() + SCAN_TIME_BUDGET_MS,
    incomplete: false,
    hashFiles: 0,
    hashBytes: 0,
  };

  const [workspace, latest] = await Promise.all([
    scanTree(workspaceDir, budget),
    headCheckpointId ? scanTree(latestDir, budget) : Promise.resolve(new Map<string, ScannedEntry>()),
  ]);

  const allPaths = new Set<string>([...workspace.keys(), ...latest.keys()]);
  const files: CheckpointDiffFile[] = [];
  const stats = emptyStats();
  let truncated = false;

  const sortedPaths = [...allPaths].sort((a, b) => a.localeCompare(b));
  for (const path of sortedPaths) {
    if (Date.now() > budget.deadline) {
      budget.incomplete = true;
      break;
    }
    if (shouldExclude(path)) continue;
    const w = workspace.get(path);
    const l = latest.get(path);

    let status: CheckpointDiffFile["status"] | null = null;
    if (w && !l) status = "A";
    else if (!w && l) status = "D";
    else if (w && l) {
      const equal = await entriesEqual(w, l, budget);
      if (equal === "timeout") break;
      if (!equal) status = "M";
    }
    if (!status) continue;

    if (files.length >= DIFF_SUMMARY_MAX_FILES) {
      truncated = true;
      accumulateStats(stats, {
        status,
        path,
        additions: null,
        deletions: null,
        binary: false,
        asset: false,
      });
      continue;
    }

    const size = w?.size ?? l?.size ?? 0;
    // Pending preview does not resolve asset pointers; large files are marked binary only.
    const binary = size > HASH_COMPARE_MAX_BYTES;
    const file: CheckpointDiffFile = {
      status,
      path,
      oldPath: null,
      additions: null,
      deletions: null,
      binary,
      asset: false,
    };
    files.push(file);
    accumulateStats(stats, file);
  }

  const response: SpacePendingDiffSummary = {
    baseCheckpointId: headCheckpointId,
    files,
    truncated: truncated || budget.incomplete,
    incomplete: budget.incomplete,
    stats,
  };

  await redisCommandClient.set(key, JSON.stringify(response), "EX", PENDING_CACHE_TTL_SECONDS).catch(() => undefined);
  return response;
}

export async function getSpacePendingDiffFile(spaceId: string, path: string): Promise<SpacePendingDiffFileResponse> {
  const normalizedPath = String(path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.includes("\0") || normalizedPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CheckpointFsError(400, "path_invalid", "Invalid path.");
  }
  if (shouldExclude(normalizedPath)) {
    throw new CheckpointFsError(400, "path_invalid", "Path is excluded from pending diffs.");
  }

  const [space] = await db
    .select({ headCheckpointId: spaces.headCheckpointId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) throw new CheckpointFsError(404, "space_not_found", "Space not found.");

  const sandbox = await getSpaceSandboxBySpaceId(spaceId).catch(() => null);
  if (sandbox?.provider === "local") {
    throw new CheckpointFsError(503, "pending_diff_unavailable", "Pending diffs unavailable for local sandboxes.");
  }

  const workspaceDir = getSpaceRoot(spaceId);
  const latestDir = getLatestDir(spaceId);
  const workspacePath = resolve(workspaceDir, normalizedPath);
  const latestPath = resolve(latestDir, normalizedPath);

  // Path traversal guard — require relative path stays under root (not a prefix sibling).
  const workspaceRel = relative(resolve(workspaceDir), workspacePath);
  const latestRel = relative(resolve(latestDir), latestPath);
  if (
    workspaceRel.startsWith("..") || isAbsolute(workspaceRel) ||
    latestRel.startsWith("..") || isAbsolute(latestRel)
  ) {
    throw new CheckpointFsError(400, "path_invalid", "Invalid path.");
  }

  const [workspaceExists, latestExists] = await Promise.all([pathExists(workspacePath), pathExists(latestPath)]);
  if (!workspaceExists && !latestExists) {
    throw new CheckpointFsError(404, "path_not_found", "File not found in workspace or last save.");
  }

  const status = workspaceExists && !latestExists ? "A" : !workspaceExists && latestExists ? "D" : "M";

  const [oldSide, newSide] = await Promise.all([
    latestExists ? readTextCapped(latestPath, PENDING_PATCH_MAX_BYTES) : Promise.resolve({ content: null, size: 0, binary: false, tooLarge: false }),
    workspaceExists ? readTextCapped(workspacePath, PENDING_PATCH_MAX_BYTES) : Promise.resolve({ content: null, size: 0, binary: false, tooLarge: false }),
  ]);

  // Asset pointer detection on either side.
  if ((oldSide.content && isAssetPointerContent(oldSide.content)) || (newSide.content && isAssetPointerContent(newSide.content))) {
    const oldSize = oldSide.content && isAssetPointerContent(oldSide.content)
      ? parseAssetPointer(oldSide.content).size
      : oldSide.size || null;
    const newSize = newSide.content && isAssetPointerContent(newSide.content)
      ? parseAssetPointer(newSide.content).size
      : newSide.size || null;
    return {
      baseCheckpointId: space.headCheckpointId ?? null,
      path: normalizedPath,
      oldPath: null,
      status,
      kind: "asset",
      binary: true,
      asset: true,
      additions: null,
      deletions: null,
      oldSize,
      newSize,
      truncated: false,
      lines: [],
    };
  }

  if (oldSide.binary || newSide.binary) {
    return {
      baseCheckpointId: space.headCheckpointId ?? null,
      path: normalizedPath,
      oldPath: null,
      status,
      kind: "binary",
      binary: true,
      asset: false,
      additions: null,
      deletions: null,
      oldSize: oldSide.size || null,
      newSize: newSide.size || null,
      truncated: false,
      lines: [],
    };
  }

  if (oldSide.tooLarge || newSide.tooLarge) {
    return {
      baseCheckpointId: space.headCheckpointId ?? null,
      path: normalizedPath,
      oldPath: null,
      status,
      kind: "too_large",
      binary: false,
      asset: false,
      additions: null,
      deletions: null,
      oldSize: oldSide.size || null,
      newSize: newSide.size || null,
      truncated: true,
      lines: [],
    };
  }

  const oldText = oldSide.content ?? "";
  const newText = newSide.content ?? "";
  const { lines, additions, deletions } = simpleLineDiff(oldText, newText);

  return {
    baseCheckpointId: space.headCheckpointId ?? null,
    path: normalizedPath,
    oldPath: null,
    status,
    kind: "text",
    binary: false,
    asset: false,
    additions,
    deletions,
    oldSize: oldSide.size || null,
    newSize: newSide.size || null,
    truncated: false,
    lines,
  };
}
