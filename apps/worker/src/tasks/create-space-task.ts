import { eq, sql } from "drizzle-orm";
import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol";
import { registerTask } from "./registry.js";
import { db } from "../db.js";
import { checkpoints, spaces } from "../db-schema.js";
import { getUserGitAccount } from "../git-accounts.js";
import { createRepository, forkRepository, renameRepository } from "../gitea.js";
import {
  buildAuthenticatedRemoteUrl,
  emptyDirectory,
  ensureSpaceWorkspaceReady,
  getSpaceWorkspaceDir,
  runGit,
  runGitWithOutput,
} from "../git.js";

type BootstrapStatus = "pending" | "running" | "ready" | "failed";
type BootstrapStage = "prepare" | "import" | "checkpoint_restore" | "push" | "finalize";

type SpaceCreateSource =
  | { type: "blank" }
  | { type: "public_git_repo"; repoUrl: string; ref?: string | null }
  | { type: "checkpoint"; checkpointId: string };

const SAFE_GIT_REF_REGEX = /^[a-zA-Z0-9._/-]+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getBootstrapMeta = (space: typeof spaces.$inferSelect) => {
  const meta = isRecord(space.meta) ? space.meta : {};
  const bootstrap = isRecord(meta.bootstrap) ? meta.bootstrap : {};
  return { meta, bootstrap };
};

const resolveSource = (payload: TaskPayload): SpaceCreateSource => {
  const source = payload.data?.source;
  if (!isRecord(source) || typeof source.type !== "string") return { type: "blank" };
  if (source.type === "public_git_repo" && typeof source.repoUrl === "string") {
    return {
      type: "public_git_repo",
      repoUrl: source.repoUrl.trim(),
      ref: typeof source.ref === "string" ? source.ref.trim() || null : null,
    };
  }
  if (source.type === "checkpoint" && typeof source.checkpointId === "string") {
    return { type: "checkpoint", checkpointId: source.checkpointId.trim() };
  }
  return { type: "blank" };
};

const sanitizeBootstrapError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/g, "$1***$3");
};

const ensureValidGitRef = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || !SAFE_GIT_REF_REGEX.test(trimmed) || trimmed.startsWith("-") || trimmed.includes("..")) {
    throw new Error("invalid git ref");
  }
  return trimmed;
};

const updateBootstrap = async (input: {
  space: typeof spaces.$inferSelect;
  taskRunId: string;
  source: SpaceCreateSource;
  status: BootstrapStatus;
  stage?: BootstrapStage;
  errorMessage?: string | null;
  startedAt?: string;
  finishedAt?: string;
}) => {
  const { meta } = getBootstrapMeta(input.space);
  const nextMeta = {
    ...meta,
    bootstrap: {
      taskRunId: input.taskRunId,
      source: input.source,
      status: input.status,
      stage: input.stage ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? (input.status === "running" ? new Date().toISOString() : null),
      finishedAt: input.finishedAt ?? (input.status === "ready" || input.status === "failed" ? new Date().toISOString() : null),
    },
  };

  const [updated] = await db
    .update(spaces)
    .set({ meta: nextMeta, updatedAt: new Date() })
    .where(eq(spaces.id, input.space.id))
    .returning();

  if (!updated) throw new Error("failed to update bootstrap state");
  return updated;
};

const commitAllAndPush = async (input: {
  workspaceDir: string;
  authenticatedRemoteUrl: string;
  branch?: string;
  message: string;
}) => {
  const branch = input.branch ?? "main";
  const gitDirCheck = await runGit(["rev-parse", "--git-dir"], input.workspaceDir)
    .then(() => true)
    .catch(() => false);
  if (!gitDirCheck) {
    await runGit(["init", "-b", branch], input.workspaceDir).catch(async () => {
      await runGit(["init"], input.workspaceDir);
    });
  }
  await runGit(["config", "user.name", "Cohub Worker"], input.workspaceDir);
  await runGit(["config", "user.email", "noreply@cohub.run"], input.workspaceDir);
  await runGit(["checkout", "-B", branch], input.workspaceDir);
  await runGit(["remote", "remove", "origin"], input.workspaceDir).catch(() => undefined);
  await runGit(["remote", "add", "origin", input.authenticatedRemoteUrl], input.workspaceDir);
  await runGit(["add", "-A"], input.workspaceDir);
  const status = await runGitWithOutput(["status", "--porcelain"], input.workspaceDir);
  if (status.stdout.trim()) {
    await runGit(["commit", "-m", input.message], input.workspaceDir);
  } else {
    await runGit(["commit", "--allow-empty", "-m", input.message], input.workspaceDir);
  }
  await runGit(["push", "-u", "origin", branch], input.workspaceDir);
  const head = await runGitWithOutput(["rev-parse", "HEAD"], input.workspaceDir);
  return { branch, commitHash: head.stdout.trim() };
};

const bootstrapBlankSpace = async (input: {
  workspaceDir: string;
  authenticatedRemoteUrl: string;
}) => {
  await emptyDirectory(input.workspaceDir);
  return commitAllAndPush({
    workspaceDir: input.workspaceDir,
    authenticatedRemoteUrl: input.authenticatedRemoteUrl,
    branch: "main",
    message: "chore: initialize space",
  });
};

const assertPublicRepoUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("public git repo url must use https");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    throw new Error("public git repo url is not allowed");
  }
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) {
    throw new Error("public git repo url is not allowed");
  }
  return url.toString();
};

const pushExistingHistory = async (input: {
  workspaceDir: string;
  authenticatedRemoteUrl: string;
}) => {
  await runGit(["remote", "remove", "origin"], input.workspaceDir).catch(() => undefined);
  await runGit(["remote", "add", "origin", input.authenticatedRemoteUrl], input.workspaceDir);

  // Resolve current branch; if detached HEAD (e.g. checked out a specific commit), create main
  const branchResult = await runGitWithOutput(["rev-parse", "--abbrev-ref", "HEAD"], input.workspaceDir);
  const currentBranch = branchResult.stdout.trim();
  const branch = currentBranch === "HEAD" ? "main" : currentBranch;
  if (currentBranch === "HEAD") {
    await runGit(["checkout", "-B", "main"], input.workspaceDir);
  }

  await runGit(["push", "-u", "origin", branch], input.workspaceDir);
  const head = await runGitWithOutput(["rev-parse", "HEAD"], input.workspaceDir);
  return { branch, commitHash: head.stdout.trim() };
};

const bootstrapFromPublicRepo = async (input: {
  workspaceDir: string;
  authenticatedRemoteUrl: string;
  repoUrl: string;
  ref?: string | null;
}) => {
  const repoUrl = assertPublicRepoUrl(input.repoUrl);
  await emptyDirectory(input.workspaceDir);
  await runGit(["clone", repoUrl, "."], input.workspaceDir);
  if (input.ref) {
    const ref = ensureValidGitRef(input.ref);
    await runGit(["checkout", ref], input.workspaceDir);
  }
  await runGit(["remote", "rename", "origin", "upstream"], input.workspaceDir).catch(() => undefined);
  return pushExistingHistory({
    workspaceDir: input.workspaceDir,
    authenticatedRemoteUrl: input.authenticatedRemoteUrl,
  });
};

const bootstrapFromCheckpoint = async (input: {
  workspaceDir: string;
  authenticatedRemoteUrl: string;
  checkpointId: string;
}) => {
  const [checkpoint] = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.id, input.checkpointId))
    .limit(1);
  if (!checkpoint) throw new Error("checkpoint not found");

  // The forked repo already has full history from the source.
  // Clone it, reset to the checkpoint commit, and force push.
  await emptyDirectory(input.workspaceDir);
  await runGit(["clone", input.authenticatedRemoteUrl, "."], input.workspaceDir);
  await runGit(["reset", "--hard", checkpoint.commitHash], input.workspaceDir);
  await runGit(["checkout", "-B", "main"], input.workspaceDir);
  await runGit(["push", "-f", "-u", "origin", "main"], input.workspaceDir);

  const head = await runGitWithOutput(["rev-parse", "HEAD"], input.workspaceDir);
  return { branch: "main", commitHash: head.stdout.trim() };
};

const createSpaceHandler = async (job: Job) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const taskRunId = String(job.id ?? "");
  if (!spaceId) throw new Error("spaceId is required for create_space task");
  if (!taskRunId) throw new Error("task run id is required for create_space task");

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) throw new Error("space not found");

  const source = resolveSource(payload);
  let currentSpace = await updateBootstrap({
    space,
    taskRunId,
    source,
    status: "running",
    stage: source.type === "checkpoint" ? "checkpoint_restore" : source.type === "public_git_repo" ? "import" : "prepare",
    startedAt: new Date().toISOString(),
  });

  try {
    const gitAccount = await getUserGitAccount(currentSpace.userUuid);

    if (source.type === "checkpoint") {
      const [checkpoint] = await db
        .select()
        .from(checkpoints)
        .where(eq(checkpoints.id, source.checkpointId))
        .limit(1);
      if (!checkpoint) throw new Error("checkpoint not found");

      const [sourceSpace] = await db
        .select()
        .from(spaces)
        .where(eq(spaces.id, checkpoint.spaceId))
        .limit(1);
      if (!sourceSpace) throw new Error("checkpoint source space not found");

      const sourceGitAccount = await getUserGitAccount(sourceSpace.userUuid);

      await forkRepository(
        sourceGitAccount.giteaUsername,
        sourceSpace.storageRepoName,
        gitAccount.giteaAccessToken,
      );

      await renameRepository(
        gitAccount.giteaUsername,
        sourceSpace.storageRepoName,
        currentSpace.storageRepoName,
        gitAccount.giteaAccessToken,
      );
    } else {
      await createRepository(gitAccount.giteaAccessToken, currentSpace.storageRepoName, false);
    }

    await ensureSpaceWorkspaceReady(currentSpace.id);
    const workspaceDir = getSpaceWorkspaceDir(currentSpace.id);
    const authenticatedRemoteUrl = buildAuthenticatedRemoteUrl({
      username: gitAccount.giteaUsername,
      accessToken: gitAccount.giteaAccessToken,
      repoName: currentSpace.storageRepoName,
    });

    let result: { branch: string; commitHash: string };
    if (source.type === "public_git_repo") {
      currentSpace = await updateBootstrap({
        space: currentSpace,
        taskRunId,
        source,
        status: "running",
        stage: "import",
      });
      result = await bootstrapFromPublicRepo({
        workspaceDir,
        authenticatedRemoteUrl,
        repoUrl: source.repoUrl,
        ref: source.ref,
      });
    } else if (source.type === "checkpoint") {
      currentSpace = await updateBootstrap({
        space: currentSpace,
        taskRunId,
        source,
        status: "running",
        stage: "checkpoint_restore",
      });
      result = await bootstrapFromCheckpoint({
        workspaceDir,
        authenticatedRemoteUrl,
        checkpointId: source.checkpointId,
      });

      await db
        .update(checkpoints)
        .set({ forkCount: sql`${checkpoints.forkCount} + 1` })
        .where(eq(checkpoints.id, source.checkpointId));

      currentSpace = (
        await db
          .update(spaces)
          .set({ baseCheckpointId: source.checkpointId, updatedAt: new Date() })
          .where(eq(spaces.id, currentSpace.id))
          .returning()
      )[0] ?? currentSpace;
    } else {
      result = await bootstrapBlankSpace({ workspaceDir, authenticatedRemoteUrl });
    }

    currentSpace = await updateBootstrap({
      space: currentSpace,
      taskRunId,
      source,
      status: "ready",
      stage: "finalize",
      finishedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      spaceId: currentSpace.id,
      branch: result.branch,
      commitHash: result.commitHash,
      source,
    };
  } catch (error) {
    await updateBootstrap({
      space: currentSpace,
      taskRunId,
      source,
      status: "failed",
      errorMessage: sanitizeBootstrapError(error),
      finishedAt: new Date().toISOString(),
    }).catch(() => undefined);
    throw error;
  }
};

registerTask("create_space", createSpaceHandler);
