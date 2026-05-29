import { createLogger } from "@cohub/infra/logging";
import { eq } from "drizzle-orm";
import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol/task";
import { registerTask } from "./registry.js";
import { db } from "../db.js";
import { spaces } from "@cohub/db";
import { emptyDirectory, ensureSpaceWorkspaceReady, getSpaceWorkspaceDir, runGit } from "../git.js";
import { publishSpaceFsChanged } from "../space-events.js";
import { saveCheckpointWithLock } from "../checkpoint/save.js";
import { saveCheckpointForSpace } from "./save-checkpoint-task.js";

const logger = createLogger({ serviceName: "cohub-worker" });
type BootstrapStatus = "pending" | "running" | "ready" | "failed";
type BootstrapStage = "prepare" | "import" | "finalize";
type SpaceCreateSource = { type: "blank" } | { type: "git_repo"; repoUrl: string; ref?: string | null };

const SAFE_GIT_REF_REGEX = /^[a-zA-Z0-9._/-]+$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const getBootstrapMeta = (space: typeof spaces.$inferSelect) => {
  const meta = isRecord(space.meta) ? space.meta : {};
  const bootstrap = isRecord(meta.bootstrap) ? meta.bootstrap : {};
  return { meta, bootstrap: isRecord(bootstrap) ? bootstrap : undefined };
};

const resolveSource = (payload: TaskPayload): SpaceCreateSource & { gitToken?: string } => {
  const source = payload.data?.source;
  if (!isRecord(source) || typeof source.type !== "string") return { type: "blank" };
  if (source.type === "git_repo" && typeof source.repoUrl === "string") {
    const gitToken = typeof payload.data?.gitToken === "string" ? (payload.data.gitToken as string).trim() || undefined : undefined;
    return { type: "git_repo", repoUrl: source.repoUrl.trim(), ref: typeof source.ref === "string" ? source.ref.trim() || null : null, gitToken };
  }
  return { type: "blank" };
};

const sanitizeBootstrapError = (value: unknown) => {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/(https?:\/\/[^:\s/@]+:)([^@\s]+)(@)/g, "$1***$3");
};

const ensureValidGitRef = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || !SAFE_GIT_REF_REGEX.test(trimmed) || trimmed.startsWith("-") || trimmed.includes("..")) throw new Error("invalid git ref");
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
  stageTimings?: Record<string, number>;
}) => {
  const { meta, bootstrap: existingBootstrap } = getBootstrapMeta(input.space);
  const nextMeta = {
    ...meta,
    bootstrap: {
      taskRunId: input.taskRunId,
      source: input.source,
      status: input.status,
      stage: input.stage ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? existingBootstrap?.startedAt ?? (input.status === "running" ? new Date().toISOString() : null),
      finishedAt: input.finishedAt ?? (input.status === "ready" || input.status === "failed" ? new Date().toISOString() : null),
      stageTimings: input.stageTimings ?? existingBootstrap?.stageTimings ?? {},
    },
  };
  const [updated] = await db.update(spaces).set({ meta: nextMeta, updatedAt: new Date() }).where(eq(spaces.id, input.space.id)).returning();
  if (!updated) throw new Error("failed to update bootstrap state");
  return updated;
};

const assertRepoUrl = (value: string, hasToken: boolean) => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("git repo url must use https");
  if (!hasToken) {
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) throw new Error("git repo url is not allowed for public access");
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) throw new Error("git repo url is not allowed for public access");
  }
  return url.toString();
};

const buildCloneUrl = (repoUrl: string, token?: string) => {
  if (!token) return repoUrl;
  const url = new URL(repoUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
};

const bootstrapFromGitRepo = async (input: { workspaceDir: string; repoUrl: string; ref?: string | null; gitToken?: string }) => {
  const repoUrl = assertRepoUrl(input.repoUrl, Boolean(input.gitToken));
  await emptyDirectory(input.workspaceDir);
  await runGit(["clone", buildCloneUrl(repoUrl, input.gitToken), "."], input.workspaceDir);
  if (input.ref) await runGit(["checkout", ensureValidGitRef(input.ref)], input.workspaceDir);
  await runGit(["remote", "set-url", "origin", repoUrl], input.workspaceDir).catch(() => undefined);
  await runGit(["remote", "rename", "origin", "upstream"], input.workspaceDir).catch(() => undefined);
};

const timeIt = async <T>(label: string, fn: () => Promise<T>): Promise<{ result: T; duration: number }> => {
  const start = performance.now();
  const result = await fn();
  const duration = Math.round(performance.now() - start);
  logger.info(`[CreateSpace] ⏱ ${label}: ${duration}ms`);
  return { result, duration };
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
  const stageTimings: Record<string, number> = {};
  let currentSpace = await updateBootstrap({ space, taskRunId, source, status: "running", stage: source.type === "git_repo" ? "import" : "prepare", startedAt: new Date().toISOString() });

  try {
    const { duration: workspaceDuration } = await timeIt("ensureSpaceWorkspaceReady", () => ensureSpaceWorkspaceReady(currentSpace.id));
    stageTimings.ensureSpaceWorkspaceReady = workspaceDuration;
    const workspaceDir = getSpaceWorkspaceDir(currentSpace.id);

    if (source.type === "git_repo") {
      currentSpace = await updateBootstrap({ space: currentSpace, taskRunId, source, status: "running", stage: "import", stageTimings });
      const { duration } = await timeIt("bootstrapFromGitRepo", () => bootstrapFromGitRepo({ workspaceDir, repoUrl: source.repoUrl, ref: source.ref, gitToken: source.gitToken }));
      stageTimings.bootstrapFromGitRepo = duration;
    } else {
      const { duration } = await timeIt("bootstrapBlankSpace", () => emptyDirectory(workspaceDir));
      stageTimings.bootstrapBlankSpace = duration;
    }

    const { result: checkpointResult, duration: checkpointDuration } = await timeIt("saveInitialCheckpoint", async () => {
      const result = await saveCheckpointWithLock({
        spaceId: currentSpace.id,
        userId: currentSpace.userUuid,
        description: "Initialize space",
        reason: "create_space_init",
      }, saveCheckpointForSpace);
      if ("skipped" in result) throw new Error("initial checkpoint save lock is busy");
      return result;
    });
    stageTimings.saveInitialCheckpoint = checkpointDuration;

    currentSpace = await updateBootstrap({ space: currentSpace, taskRunId, source, status: "ready", stage: "finalize", finishedAt: new Date().toISOString(), stageTimings });

    await publishSpaceFsChanged(currentSpace.id, { source: "bootstrap", resync: true, changes: [] }).catch((error) => {
      logger.warn(`[CreateSpace] Failed to publish bootstrap fs resync for ${currentSpace.id}: ${error instanceof Error ? error.message : String(error)}`);
    });

    return { ok: true, spaceId: currentSpace.id, branch: checkpointResult.branch, commitHash: checkpointResult.commitHash, checkpointId: checkpointResult.checkpointId, source };
  } catch (error) {
    await updateBootstrap({ space: currentSpace, taskRunId, source, status: "failed", errorMessage: sanitizeBootstrapError(error), stageTimings, finishedAt: new Date().toISOString() }).catch(() => undefined);
    throw error;
  }
};

registerTask("create_space", createSpaceHandler);
