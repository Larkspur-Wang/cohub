import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import type { TaskPayload } from "@neta-art/cohub-protocol/task";
import { registerTask } from "./registry.js";
import { db } from "../db.js";
import { checkpoints, spaces, userGitAccounts } from "../db-schema.js";
import { decryptSecret } from "../crypto.js";
import { buildAuthenticatedRemoteUrl, getSpaceWorkspaceDir, runGit, runGitWithOutput } from "../git.js";
import { publishUserConfigFromWorkspace } from "../user-config-publish.js";

const buildCommitMessage = (description?: string | null) => {
  const trimmed = description?.trim();
  return trimmed?.length ? `checkpoint: ${trimmed}` : "checkpoint: save from cohub";
};

const saveCheckpointHandler = async (job: Job) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const description = (payload.data?.description as string | undefined) ?? null;

  if (!spaceId) {
    throw new Error("spaceId is required for save_checkpoint task");
  }

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) throw new Error("space not found");

  const [gitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, space.userUuid))
    .limit(1);
  if (!gitAccount) throw new Error("git account not found");

  const workspaceDir = getSpaceWorkspaceDir(spaceId);
  await runGit(["rev-parse", "--is-inside-work-tree"], workspaceDir).catch(() => {
    throw new Error("space repo is not initialized");
  });

  const status = await runGitWithOutput(["status", "--porcelain"], workspaceDir);
  const changedLines = status.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const hasChanges = changedLines.length > 0;

  // Check if HEAD exists (repo has at least one commit)
  const hasHead = await runGitWithOutput(["rev-parse", "--verify", "HEAD"], workspaceDir).then(
    () => true,
    () => false,
  );
  const branchResult = hasHead
    ? await runGitWithOutput(["rev-parse", "--abbrev-ref", "HEAD"], workspaceDir)
    : { stdout: "" };
  const branch = branchResult.stdout.trim() || "main";
  const commitMessage = buildCommitMessage(description);

  // Use a dedicated remote to avoid touching the user's "origin"
  const COHUB_REMOTE = "cohub";
  const accessToken = decryptSecret(gitAccount.giteaAccessTokenEncrypted);
  const authenticatedRemoteUrl = buildAuthenticatedRemoteUrl({
    username: gitAccount.giteaUsername,
    accessToken,
    repoName: space.storageRepoName,
  });

  // Ensure the cohub remote exists with the authenticated URL
  // (re-create each time in case access token was rotated)
  await runGit(["remote", "remove", COHUB_REMOTE], workspaceDir).catch(() => undefined);
  await runGit(["remote", "add", COHUB_REMOTE, authenticatedRemoteUrl], workspaceDir);

  if (hasChanges) {
    await runGit(["add", "-A"], workspaceDir);
    await runGit(["config", "user.name", "Cohub Worker"], workspaceDir);
    await runGit(["config", "user.email", "noreply@cohub.run"], workspaceDir);
    await runGit(["commit", "-m", commitMessage], workspaceDir);
  }

  // Always push in case the remote was updated via another remote
  try {
    await runGit(["push", COHUB_REMOTE, branch], workspaceDir);
  } finally {
    // Clean up the cohub remote so authenticated URL is not left on disk
    await runGit(["remote", "remove", COHUB_REMOTE], workspaceDir).catch(() => undefined);
  }

  const head = await runGitWithOutput(["rev-parse", "HEAD"], workspaceDir);
  const commitHash = head.stdout.trim();

  const [checkpoint] = await db
    .insert(checkpoints)
    .values({
      spaceId,
      commitHash,
      description: description?.trim() || "Checkpoint",
      parentCheckpointId: space.headCheckpointId ?? null,
      meta: {
        branch,
        commitMessage,
        changedFiles: changedLines.length,
        savedBy: payload.userId ?? null,
        source: "worker_save_checkpoint",
      },
    })
    .returning();

  if (!checkpoint) throw new Error("failed to create checkpoint record");

  await db
    .update(spaces)
    .set({
      headCheckpointId: checkpoint.id,
      updatedAt: new Date(),
    })
    .where(eq(spaces.id, spaceId));

  let publishedUserConfig: {
    targetDir: string;
    copiedPaths: string[];
    meta: Record<string, unknown>;
  } | null = null;

  if (space.name === "config") {
    publishedUserConfig = await publishUserConfigFromWorkspace({
      userId: space.userUuid,
      spaceId: space.id,
      checkpointId: checkpoint.id,
      workspaceDir,
    });
  }

  return {
    checkpointId: checkpoint.id,
    commitHash,
    branch,
    commitMessage,
    changedFiles: changedLines.length,
    spaceId,
    ...(publishedUserConfig ? { publishedUserConfig } : {}),
  };
};

registerTask("save_checkpoint", saveCheckpointHandler);
