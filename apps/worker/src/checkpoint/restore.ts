import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { checkpoints, spaces } from "@cohub/db";
import { db } from "../db.js";
import { config } from "../config.js";
import { getCheckpointSystemRepoDir, CHECKPOINT_ASSET_MANIFEST_PATH, CHECKPOINT_META_PATH, USER_GIT_REPOS_PATH } from "./paths.js";
import { ensureGitRepo, runGit } from "./git.js";
import { getCheckpointAssetClient } from "./assets.js";
import { emptyDirectory } from "../git.js";

type AssetManifest = {
  version: number;
  assets?: Array<{ path: string; objectKey: string; size?: number; sha256?: string; mimeType?: string | null }>;
};

type UserGitReposManifest = {
  version: number;
  repos?: Array<{ path: string; head: string | null; branch: string | null; bundle: { objectKey: string; sha256: string; size: number } | null }>;
};

const toPosix = (value: string) => value.replace(/\\/g, "/");

function assertSafeRelativePath(path: string) {
  const normalized = toPosix(path).trim();
  if (normalized === ".") return normalized;
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`unsafe checkpoint path: ${path}`);
  }
  return normalized;
}

function safeJoin(root: string, path: string) {
  const safePath = assertSafeRelativePath(path);
  const target = resolve(root, safePath);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${path}`);
  return target;
}

const isSafeSymlinkTarget = (target: string) => {
  if (isAbsolute(target)) return false;
  const normalized = normalize(target).replace(/\\/g, "/");
  return normalized !== ".." && !normalized.startsWith("../");
};

async function downloadObjectToFile(objectKey: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true, mode: 0o775 });
  const result = await getCheckpointAssetClient().send(new GetObjectCommand({ Bucket: config.checkpointAssetOssBucket, Key: objectKey }));
  if (!result.Body) throw new Error(`empty object body: ${objectKey}`);
  await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(targetPath));
}

async function collectFiles(root: string, dir = root): Promise<string[]> {
  const names = await readdir(dir).catch(() => []);
  const nested = await Promise.all(names.map(async (name) => {
    const absPath = join(dir, name);
    const rel = toPosix(relative(root, absPath));
    const st = await lstat(absPath).catch(() => null);
    if (!st) return [];
    if (st.isDirectory() && !st.isSymbolicLink()) return [rel, ...await collectFiles(root, absPath)];
    return [rel];
  }));
  return nested.flat();
}

async function copyEntry(source: string, target: string) {
  const st = await lstat(source);
  await mkdir(dirname(target), { recursive: true, mode: 0o775 });
  await rm(target, { recursive: true, force: true });
  if (st.isSymbolicLink()) {
    const link = await readlink(source);
    if (!isSafeSymlinkTarget(link)) throw new Error(`unsafe symlink target while restoring ${source}`);
    await symlink(link, target);
    return;
  }
  await copyFile(source, target, constants.COPYFILE_FICLONE).catch(async () => copyFile(source, target));
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

async function archiveSourceCommit(input: { sourceRepoDir: string; commitHash: string; restoreTmpDir: string }) {
  await rm(input.restoreTmpDir, { recursive: true, force: true });
  await mkdir(input.restoreTmpDir, { recursive: true, mode: 0o775 });
  await new Promise<void>((resolve, reject) => {
    const archive = spawn("git", ["-c", `safe.directory=${input.sourceRepoDir}`, "archive", "--format=tar", input.commitHash], { cwd: input.sourceRepoDir, stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-xf", "-", "-C", input.restoreTmpDir], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    archive.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    tar.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    archive.stdout.pipe(tar.stdin);
    archive.on("error", reject);
    tar.on("error", reject);
    archive.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `git archive exited with ${code}`));
    });
    tar.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `tar exited with ${code}`)));
  });
}

async function restoreFilesFromArchive(input: { restoreTmpDir: string; targetDir: string; assetManifest: AssetManifest }) {
  await emptyDirectory(input.targetDir);
  const assets = new Map((input.assetManifest.assets ?? []).map((asset) => [assertSafeRelativePath(asset.path), asset]));
  const files = await collectFiles(input.restoreTmpDir);
  await Promise.all(files.map(async (rel) => {
    if (rel === ".cohub" || rel.startsWith(".cohub/system/")) return;
    const safeRel = assertSafeRelativePath(rel);
    if (safeRel === ".cohub/system" || safeRel.startsWith(".cohub/system/")) return;
    const asset = assets.get(safeRel);
    const target = safeJoin(input.targetDir, safeRel);
    if (asset) {
      await downloadObjectToFile(asset.objectKey, target);
      return;
    }
    await copyEntry(safeJoin(input.restoreTmpDir, safeRel), target);
  }));
}

async function restoreUserGitRepos(input: { workspaceDir: string; restoreTmpDir: string; manifest: UserGitReposManifest }) {
  const bundleDir = join(input.restoreTmpDir, ".cohub-restore-bundles");
  await mkdir(bundleDir, { recursive: true, mode: 0o775 });
  for (const repo of input.manifest.repos ?? []) {
    if (!repo.bundle || !repo.head) continue;
    const repoPath = repo.path === "." ? "." : assertSafeRelativePath(repo.path);
    const repoDir = repoPath === "." ? input.workspaceDir : safeJoin(input.workspaceDir, repoPath);
    await mkdir(repoDir, { recursive: true, mode: 0o775 });
    const bundlePath = join(bundleDir, `${repo.bundle.sha256}.bundle`);
    await downloadObjectToFile(repo.bundle.objectKey, bundlePath);
    await runGit(["init"], repoDir);
    await runGit(["fetch", bundlePath, "refs/*:refs/*"], repoDir);
    if (repo.branch) await runGit(["symbolic-ref", "HEAD", `refs/heads/${repo.branch}`], repoDir).catch(() => undefined);
    await runGit(["reset", "--mixed", repo.head], repoDir);
  }
}

export async function restoreWorkspaceFromCheckpoint(input: {
  checkpointId: string;
  targetWorkspaceDir: string;
  restoreTmpDir: string;
}) {
  const [checkpoint] = await db.select().from(checkpoints).where(eq(checkpoints.id, input.checkpointId)).limit(1);
  if (!checkpoint) throw new Error("checkpoint not found");
  const [sourceSpace] = await db.select().from(spaces).where(eq(spaces.id, checkpoint.spaceId)).limit(1);
  if (!sourceSpace) throw new Error("checkpoint source space not found");
  const sourceRepoDir = getCheckpointSystemRepoDir(sourceSpace.id);
  await archiveSourceCommit({ sourceRepoDir, commitHash: checkpoint.commitHash, restoreTmpDir: input.restoreTmpDir });
  const assetManifest = await readJson<AssetManifest>(join(input.restoreTmpDir, CHECKPOINT_ASSET_MANIFEST_PATH), { version: 1, assets: [] });
  const gitReposManifest = await readJson<UserGitReposManifest>(join(input.restoreTmpDir, USER_GIT_REPOS_PATH), { version: 1, repos: [] });
  await restoreFilesFromArchive({ restoreTmpDir: input.restoreTmpDir, targetDir: input.targetWorkspaceDir, assetManifest });
  await restoreUserGitRepos({ workspaceDir: input.targetWorkspaceDir, restoreTmpDir: input.restoreTmpDir, manifest: gitReposManifest });
  return { checkpoint, sourceSpace, assetManifest, gitReposManifest };
}

export async function restoreSystemRepoFromCheckpoint(input: {
  sourceSpaceId: string;
  targetRepoDir: string;
  commitHash: string;
}) {
  await rm(input.targetRepoDir, { recursive: true, force: true });
  await mkdir(input.targetRepoDir, { recursive: true, mode: 0o775 });
  await ensureGitRepo(input.targetRepoDir, "main");
  const sourceRepoDir = getCheckpointSystemRepoDir(input.sourceSpaceId);
  await runGit(["remote", "add", "source", sourceRepoDir], input.targetRepoDir);
  try {
    await runGit(["fetch", "source", input.commitHash], input.targetRepoDir);
    await runGit(["checkout", "-B", "main", "FETCH_HEAD"], input.targetRepoDir);
  } finally {
    await runGit(["remote", "remove", "source"], input.targetRepoDir).catch(() => undefined);
  }
}

export async function writeLatestMeta(input: { latestDir: string; meta: Record<string, unknown> }) {
  await mkdir(join(input.latestDir, dirname(CHECKPOINT_META_PATH)), { recursive: true, mode: 0o775 });
  await writeFile(join(input.latestDir, CHECKPOINT_META_PATH), `${JSON.stringify(input.meta, null, 2)}\n`);
}
