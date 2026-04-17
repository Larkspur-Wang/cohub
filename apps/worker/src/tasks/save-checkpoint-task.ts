import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol";
import { registerTask } from "./registry.js";
import { db } from "../db.js";
import { checkpoints, spaces, userGitAccounts } from "../db-schema.js";
import { decryptSecret } from "../crypto.js";
import { config } from "../config.js";

const runGitWithOutput = async (args: string[], cwd: string) => {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `git ${args[0]} exited with non-zero status ${code}`));
    });
  });
};

const runGit = async (args: string[], cwd: string) => {
  await runGitWithOutput(args, cwd);
};

const getSpaceWorkspaceDir = (spaceId: string) => `${config.spaceStorageRoot}/${spaceId}/workspace`;

const buildAuthenticatedRemoteUrl = (input: {
  username: string;
  accessToken: string;
  repoName: string;
}) => {
  const base = new URL("https://gitea.cohub.run");
  base.username = input.username;
  base.password = input.accessToken;
  base.pathname = `/${input.username}/${input.repoName}.git`;
  return base.toString();
};

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
  if (changedLines.length === 0) {
    throw new Error("no changes to checkpoint");
  }

  const branchResult = await runGitWithOutput(["rev-parse", "--abbrev-ref", "HEAD"], workspaceDir);
  const branch = branchResult.stdout.trim() || "main";
  const commitMessage = buildCommitMessage(description);

  const originResult = await runGitWithOutput(["remote", "get-url", "origin"], workspaceDir);
  const originalRemoteUrl = originResult.stdout.trim();
  const accessToken = decryptSecret(gitAccount.giteaAccessTokenEncrypted);
  const authenticatedRemoteUrl = buildAuthenticatedRemoteUrl({
    username: gitAccount.giteaUsername,
    accessToken,
    repoName: space.storageRepoName,
  });

  await runGit(["add", "-A"], workspaceDir);
  await runGit(["commit", "-m", commitMessage], workspaceDir);

  try {
    await runGit(["remote", "set-url", "origin", authenticatedRemoteUrl], workspaceDir);
    await runGit(["push", "origin", branch], workspaceDir);
  } finally {
    await runGit(["remote", "set-url", "origin", originalRemoteUrl], workspaceDir).catch(() => undefined);
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

  return {
    checkpointId: checkpoint.id,
    commitHash,
    branch,
    commitMessage,
    changedFiles: changedLines.length,
    spaceId,
  };
};

registerTask("save_checkpoint", saveCheckpointHandler);
