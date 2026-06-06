import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol/task";
import { checkpoints, spaces } from "@cohub/db";
import { registerTask } from "./registry.js";
import { db } from "../db.js";
import { config } from "../config.js";
import { publishUserConfigFromWorkspace, publishConfigFromWorkspace } from "../config-publish.js";
import { getGenerationsDir, publishGenerationsCacheFromDir } from "../generations-cache.js";
import { publishModelsCacheFromFile } from "../models-cache.js";
import { getPromptsDir, publishPromptsCacheFromDir } from "../prompts-cache.js";
import { uploadAssetIfMissing } from "../checkpoint/assets.js";
import { ensureGitRepo, runGit, runGitWithOutput } from "../checkpoint/git.js";
import { collectUserGitRepos } from "../checkpoint/git-bundles.js";
import { saveCanvasCheckpointSnapshots } from "../checkpoint/canvas.js";
import { materializeLatest } from "../checkpoint/materialize.js";
import { CHECKPOINT_ASSET_MANIFEST_PATH, CHECKPOINT_META_PATH, USER_GIT_REPOS_PATH, ensureCheckpointDirs, getCheckpointLatestSubPath } from "../checkpoint/paths.js";
import { syncSystemRepo, type CheckpointAsset } from "../checkpoint/repo-sync.js";
import { saveCheckpointWithLock, type SaveCheckpointInput, type SaveCheckpointResult } from "../checkpoint/save.js";
import { hashFile, scanWorkspace, type ScannedFile } from "../checkpoint/scan.js";
import { buildInternalRepoRemoteUrl, createInternalRepository } from "../gitea.js";

const SAVE_VERSION = 2;

const buildCommitMessage = (description?: string | null) => {
  const trimmed = description?.trim();
  return trimmed?.length ? `checkpoint: ${trimmed}` : "checkpoint: save from cohub";
};

type SaveCheckpointTimings = Record<string, number>;

const timeIt = async <T>(timings: SaveCheckpointTimings, label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const duration = Math.round(performance.now() - start);
    timings[label] = (timings[label] ?? 0) + duration;
    console.info(`[save_checkpoint] ⏱ ${label}: ${duration}ms`);
  }
};

async function mirrorToGitea(repoDir: string, repoName: string, branch: string) {
  await createInternalRepository(repoName, true);
  const remoteUrl = buildInternalRepoRemoteUrl(repoName);
  await runGit(["remote", "remove", "cohub"], repoDir).catch(() => undefined);
  await runGit(["remote", "add", "cohub", remoteUrl], repoDir);
  try {
    await runGit(["push", "-u", "cohub", branch], repoDir);
  } finally {
    await runGit(["remote", "remove", "cohub"], repoDir).catch(() => undefined);
  }
}

export const saveCheckpointForSpace = async (input: SaveCheckpointInput): Promise<SaveCheckpointResult> => {
  const spaceId = input.spaceId;
  const description = input.description ?? null;

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) throw new Error("space not found");

  const timings: SaveCheckpointTimings = {};
  const progress = (stage: string, extra?: Record<string, unknown>) => input.onProgress?.({ stage, updatedAt: new Date().toISOString(), timings, ...extra });
  await progress("prepare");
  const checkpointId = crypto.randomUUID();
  const createdAt = new Date();
  const branch = "main";
  const commitMessage = buildCommitMessage(description);
  const dirs = await timeIt(timings, "ensureCheckpointDirs", () => ensureCheckpointDirs(spaceId));

  await timeIt(timings, "ensureGitRepo", () => ensureGitRepo(dirs.repoDir, branch));
  await progress("scan_workspace");
  const scan = await timeIt(timings, "scanWorkspace", () => scanWorkspace(dirs.workspaceDir));
  await progress("upload_assets", { fileCount: scan.files.length, gitRepoCount: scan.gitRepos.length });
  const assets: CheckpointAsset[] = [];
  const smallFiles: ScannedFile[] = [];
  await timeIt(timings, "processAssets", async () => {
    for (const file of scan.files) {
      if (file.type === "file" && file.size > config.checkpointAssetThresholdBytes) {
        const sha256 = await timeIt(timings, "hashAssets", () => hashFile(file.absPath));
        const objectKey = await timeIt(timings, "uploadAssets", () => uploadAssetIfMissing({ filePath: file.absPath, sha256, size: file.size, mimeType: file.mimeType }));
        assets.push({ path: file.path, sha256, size: file.size, mimeType: file.mimeType, objectKey });
      } else {
        smallFiles.push(file);
      }
    }
  });

  await progress("bundle_git_repos", { assetCount: assets.length });
  const userGitRepos = await timeIt(timings, "collectUserGitRepos", () => collectUserGitRepos({
    workspaceDir: dirs.workspaceDir,
    systemDir: dirs.systemDir,
    tmpDir: dirs.tmpDir,
    repoPaths: scan.gitRepos.map((repo) => repo.path),
  }));
  const userGitReposManifest = { version: 1, repos: userGitRepos };

  const gitCheckpointMeta = {
    version: 1,
    saveVersion: SAVE_VERSION,
    spaceId,
    checkpointId,
    createdAt: createdAt.toISOString(),
    description: description?.trim() || "Checkpoint",
    branch,
  };

  await progress("commit_checkpoint", { gitRepoCount: userGitRepos.length });
  await timeIt(timings, "syncSystemRepo", () => syncSystemRepo({ repoDir: dirs.repoDir, smallFiles, assets, gitCheckpointMeta, userGitRepos: userGitReposManifest }));
  await timeIt(timings, "gitAdd", () => runGit(["add", "-A"], dirs.repoDir));
  await timeIt(timings, "gitCommit", () => runGit(["commit", "--allow-empty", "-m", commitMessage], dirs.repoDir));
  const head = await timeIt(timings, "gitRevParse", () => runGitWithOutput(["rev-parse", "HEAD"], dirs.repoDir));
  const commitHash = head.stdout.trim();

  const latestMeta = { ...gitCheckpointMeta, commitHash, materializedAt: new Date().toISOString() };
  await progress("materialize_latest", { commitHash });
  await timeIt(timings, "materializeLatest", () => materializeLatest({ latestDir: dirs.latestDir, files: scan.files, checkpointMeta: latestMeta }));

  const smallFileCount = smallFiles.length;
  const smallFileBytes = smallFiles.reduce((sum, file) => sum + file.size, 0);
  const assetCount = assets.length;
  const assetBytes = assets.reduce((sum, asset) => sum + asset.size, 0);
  const detectedGitRepoCount = userGitRepos.length;
  const bundledGitRepoCount = userGitRepos.filter((repo) => repo.bundle).length;
  const gitBundleBytes = userGitRepos.reduce((sum, repo) => sum + (repo.bundle?.size ?? 0), 0);
  const stats = {
    fileCount: smallFileCount + assetCount,
    fileBytes: smallFileBytes + assetBytes,
    smallFileCount,
    smallFileBytes,
    assetCount,
    assetBytes,
    ignoredCount: scan.ignoredCount,
    unsupportedCount: scan.warnings.length,
    detectedGitRepoCount,
    bundledGitRepoCount,
    gitBundleBytes,
  };

  await progress("write_checkpoint_record");
  const rootCheckpointId = await timeIt(timings, "resolveRootCheckpoint", async () => (
    space.headCheckpointId ? ((await db.select({ rootCheckpointId: checkpoints.rootCheckpointId, id: checkpoints.id }).from(checkpoints).where(eq(checkpoints.id, space.headCheckpointId)).limit(1))[0]?.rootCheckpointId ?? space.headCheckpointId) : checkpointId
  ));
  const [checkpoint] = await timeIt(timings, "writeCheckpointRecord", () => db.insert(checkpoints).values({
    id: checkpointId,
    spaceId,
    commitHash,
    description: description?.trim() || "Checkpoint",
    parentCheckpointId: space.headCheckpointId ?? null,
    rootCheckpointId,
    saveVersion: SAVE_VERSION,
    meta: {
      version: SAVE_VERSION,
      branch,
      commitMessage,
      paths: {
        assetManifest: CHECKPOINT_ASSET_MANIFEST_PATH,
        checkpointMeta: CHECKPOINT_META_PATH,
        userGitRepos: USER_GIT_REPOS_PATH,
        latestSubPath: getCheckpointLatestSubPath(spaceId),
      },
      stats,
      timings,
      warnings: [
        ...scan.warnings,
        ...userGitRepos.flatMap((repo) => repo.remotes.filter((remote) => remote.credentialSanitized).map((remote) => ({
          path: repo.path,
          type: "git_remote",
          action: "sanitized" as const,
          reason: "credential_in_remote_url",
          remote: remote.name,
        }))),
      ],
      source: input.reason ?? "save_checkpoint",
      savedBy: input.userId ?? null,
      mirror: { status: "queued" },
    },
    createdAt,
  }).returning());

  if (!checkpoint) throw new Error("failed to create checkpoint record");
  const canvasSnapshots = await timeIt(timings, "saveCanvasCheckpointSnapshots", () => saveCanvasCheckpointSnapshots({ checkpointId: checkpoint.id, spaceId }));
  await timeIt(timings, "updateCheckpointCanvasMeta", () => db.update(checkpoints).set({ meta: { ...(checkpoint.meta as Record<string, unknown> | null), timings, canvas: { snapshotCount: canvasSnapshots.count } } }).where(eq(checkpoints.id, checkpoint.id)));
  await timeIt(timings, "updateSpaceHead", () => db.update(spaces).set({ headCheckpointId: checkpoint.id, updatedAt: new Date() }).where(eq(spaces.id, spaceId)));

  await progress("mirror_gitea");
  let mirrorMeta: { status: "pushed"; pushedAt: string } | { status: "failed"; error: string };
  await timeIt(timings, "mirrorGitea", async () => {
    try {
      await mirrorToGitea(dirs.repoDir, space.storageRepoName, branch);
      mirrorMeta = { status: "pushed", pushedAt: new Date().toISOString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mirrorMeta = { status: "failed", error: message };
      console.warn(`[save_checkpoint] failed to mirror repo for space=${spaceId} checkpoint=${checkpoint.id}:`, error);
    }
  });
  await timeIt(timings, "updateMirrorMeta", () => db.update(checkpoints).set({ meta: { ...(checkpoint.meta as Record<string, unknown> | null), timings, mirror: mirrorMeta } }).where(eq(checkpoints.id, checkpoint.id)));

  let publishedUserConfig: { targetDir: string; copiedPaths: string[]; meta: Record<string, unknown> } | null = null;
  if (space.name === "config") {
    publishedUserConfig = await timeIt(timings, "publishUserConfig", () => publishUserConfigFromWorkspace({ userId: space.userUuid, spaceId: space.id, checkpointId: checkpoint.id, workspaceDir: dirs.latestDir }));
    await publishModelsCacheFromFile({ modelsPath: join(publishedUserConfig.targetDir, ".cohub", "models.json"), scope: "user", userId: space.userUuid, sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish user models cache user=${space.userUuid}:`, error));
    await publishGenerationsCacheFromDir({ generationsDir: getGenerationsDir(publishedUserConfig.targetDir), scope: "user", userId: space.userUuid, sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish user generations cache user=${space.userUuid}:`, error));
    await publishPromptsCacheFromDir({ promptsDir: getPromptsDir(publishedUserConfig.targetDir), scope: "user", userId: space.userUuid, sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish user prompts cache user=${space.userUuid}:`, error));
  }

  let publishedPlatformConfig: { targetDir: string; copiedPaths: string[]; meta: Record<string, unknown> } | null = null;
  if (config.platformSpaceId && spaceId === config.platformSpaceId) {
    publishedPlatformConfig = await timeIt(timings, "publishPlatformConfig", () => publishConfigFromWorkspace({ workspaceDir: dirs.latestDir, checkpointId: checkpoint.id, targetDir: "/configs/platform", whitelist: ["AGENTS.md", "CLAUDE.md", ".agents", ".cohub"], sourceLabel: "platform" }));
    await publishModelsCacheFromFile({ modelsPath: join(publishedPlatformConfig.targetDir, ".cohub", "models.json"), scope: "platform", sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish platform models cache:`, error));
    await publishGenerationsCacheFromDir({ generationsDir: getGenerationsDir(publishedPlatformConfig.targetDir), scope: "platform", sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish platform generations cache:`, error));
    await publishPromptsCacheFromDir({ promptsDir: getPromptsDir(publishedPlatformConfig.targetDir), scope: "platform", sourceCheckpointId: checkpoint.id }).catch((error) => console.warn(`[save_checkpoint] failed to publish platform prompts cache:`, error));
  }

  await progress("completed", { checkpointId: checkpoint.id, commitHash });
  return { checkpointId: checkpoint.id, commitHash, branch, commitMessage, changedFiles: scan.files.length, assetCount, detectedGitRepoCount, timings, spaceId, latestSubPath: getCheckpointLatestSubPath(spaceId), ...(publishedUserConfig ? { publishedUserConfig } : {}), ...(publishedPlatformConfig ? { publishedPlatformConfig } : {}) };
};

const saveCheckpointHandler = async (job: Job) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  if (!spaceId) throw new Error("spaceId is required for save_checkpoint task");
  const description = (payload.data?.description as string | undefined) ?? null;
  const reason = (payload.data?.reason as string | undefined) ?? "save_checkpoint";
  return saveCheckpointWithLock({ spaceId, userId: payload.userId, description, reason, onProgress: (progress) => job.updateProgress(progress) }, saveCheckpointForSpace);
};

registerTask("save_checkpoint", saveCheckpointHandler);
