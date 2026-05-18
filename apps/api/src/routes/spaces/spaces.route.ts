import { Hono } from "hono";
import type { ContentBlock } from "@cohub/protocol/core";
import * as cronParser from "cron-parser";
import { db } from "../../db/index.js";
import {
  userChannels,
  spaceChannels,
  spaces,
  spaceMembers,
  userGitAccounts,
} from "@cohub/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { useAuth, getOptionalAuth, requireValidId, buildSpaceListItems, buildStorageRepoName } from "../../lib/middleware.js";
import { ensureUserGitAccount } from "../../git-accounts.js";
import { config } from "../../config.js";
import { attachSandboxPublicEndpoints } from "../../sandbox-public-network.js";
import { getSpaceSandboxBySpaceId, recoverSpaceSandbox, reconcileSpaceSandbox } from "../../space-sandboxes.js";
import {
  createInitialSpaceSession,
  getSpaceById,
  getSpaceSessionById,
  listSpaceSessions,
  normalizeSpaceEnv,
  validateSpaceEnv,
  setSpaceEnv,
  SandboxNotReadyError,
  SpaceEnvValidationError,
} from "../../space-sessions.js";
import { syncSpaceChannelConfigCache, getSpaceChannelsBySpaceId, bindSpaceChannelsToGateway, unbindSpaceChannelFromGateway } from "../../channels.js";
import { createCronJob, enqueueTask } from "../../tasks.js";
import { hasPermission, getSpaceMemberRole, filterSessionsByPermission } from "../../permissions.js";
import { checkpoints } from "@cohub/db";
import type { AuthUser } from "../../lib/middleware.js";
import { submitSessionPrompt } from "../../session-prompts.js";
import { listSessionForksForSessions } from "../../session-forks.js";
import { fallbackPublicUserProfile, getProfilesByUuids } from "../../user-profiles.js";
import { SYSTEM_ENV_KEY_SET } from "@cohub/protocol/sandbox";

type GitAccount = Awaited<ReturnType<typeof ensureUserGitAccount>>;

const router = new Hono();
const { CronExpressionParser } = cronParser;

type SpacePromptSchedule =
  | { mode?: "immediate" }
  | { mode: "delay"; delayMs?: number }
  | { mode: "at"; sendAt?: string }
  | { mode: "repeat"; cronExpression?: string; timezone?: string };

type SpacePromptInput = {
  sessionId?: string | null;
  title?: string | null;
  content?: ContentBlock[];
  model?: string | null;
  provider?: string | null;
  clientMessageId?: string | null;
  schedule?: SpacePromptSchedule | null;
};

const hasExplicitTimezone = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim());

function validatePromptContentBlocks(content: unknown): content is ContentBlock[] {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => block && typeof block === "object" && !Array.isArray(block) && typeof (block as { type?: unknown }).type === "string");
}

function promptInputError(error: unknown): string | null {
  if (error instanceof SandboxNotReadyError) return null;
  if (!(error instanceof Error)) return String(error);
  if (
    error.message.includes("content") ||
    error.message.includes("clientMessageId") ||
    error.message.includes("userId") ||
    error.message.includes("Invalid image") ||
    error.message.includes("Invalid content block") ||
    error.message.includes("shell command is empty")
  ) {
    return error.message;
  }
  return null;
}

const isPositiveSafeInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

const validateTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const parseScheduledAt = (sendAt: string) => {
  const trimmed = sendAt.trim();
  if (!hasExplicitTimezone(trimmed)) {
    throw new Error("sendAt must include timezone, e.g. 2026-05-09T10:00:00+08:00 or 2026-05-09T02:00:00Z");
  }
  const scheduledAt = new Date(trimmed);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("sendAt must be a valid ISO 8601 datetime, e.g. 2026-05-09T10:00:00+08:00");
  }
  if (scheduledAt.getTime() <= Date.now()) throw new Error("sendAt must be in the future");
  return scheduledAt;
};

const validateRepeatSchedule = (input: { cronExpression: string; timezone: string }) => {
  const cronExpression = input.cronExpression.trim();
  const timezone = input.timezone.trim();
  if (cronExpression.split(/\s+/).length !== 5) {
    throw new Error("cronExpression must have 5 fields, e.g. 0 9 * * *");
  }
  if (!validateTimezone(timezone)) throw new Error("timezone must be an IANA timezone, e.g. Asia/Shanghai or UTC");
  const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
  const nextRun = interval.next().toDate();
  const secondRun = interval.next().toDate();
  if (secondRun.getTime() - nextRun.getTime() < 60_000) {
    throw new Error("cron interval must be at least 1 minute");
  }
  return { cronExpression, timezone, nextRun };
};

// ── Provisioning params builder ──────────────────────────────────────────────

function getSpaceProvisionParams(
  user: AuthUser,
  space: typeof spaces.$inferSelect,
  _gitAccount: GitAccount,
) {
  return {
    spaceId: space.id,
    userUuid: user.uuid,
    ownerUserUuid: space.userUuid,
  };
}

router.get("/", async (c) => {
  const user = useAuth(c);

  const owned = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.userUuid, user.uuid));
  const member = await db
    .select({ id: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, user.uuid));

  const spaceIds = Array.from(new Set([...owned.map((item) => item.id), ...member.map((item) => item.id)]));
  if (spaceIds.length === 0) return c.json([]);

  const spaceList = await db
    .select()
    .from(spaces)
    .where(inArray(spaces.id, spaceIds))
    .orderBy(desc(spaces.updatedAt), desc(spaces.createdAt));

  const items = await buildSpaceListItems(spaceList);
  return c.json(items);
});

// ── POST /api/spaces ─────────────────────────────────────────────────────────

router.post("/", async (c) => {
  const user = useAuth(c);

  const body = (await c.req
    .json<{
      name?: string;
      description?: string | null;
      source?: string;
      cwd?: string;
      protocol?: "pi" | "acp" | "internal";
      meta?: Record<string, unknown>;
      extraEnv?: Array<{ name: string; value: string }>;
      channelBindings?: Array<{ channelId: string; config?: Record<string, unknown> | null }>;
      bootstrapSource?:
        | { type: "blank" }
        | { type: "git_repo"; repoUrl?: string; ref?: string | null }
        | { type: "checkpoint"; checkpointId?: string };
    gitHubToken?: string;
    }>()
    .catch(() => ({}))) as {
    name?: string;
    description?: string | null;
    source?: string;
    cwd?: string;
    protocol?: "pi" | "acp" | "internal";
    meta?: Record<string, unknown>;
    extraEnv?: Array<{ name: string; value: string }>;
    channelBindings?: Array<{ channelId: string; config?: Record<string, unknown> | null }>;
    bootstrapSource?:
      | { type: "blank" }
      | { type: "git_repo"; repoUrl?: string; ref?: string | null }
      | { type: "checkpoint"; checkpointId?: string };
    gitHubToken?: string;
  };

  const name = body.name?.trim();
  if (!name) return c.json({ message: "name is required" }, 400);

  const existingSpace = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.userUuid, user.uuid), eq(spaces.name, name)))
    .limit(1);
  if (existingSpace.length > 0) return c.json({ message: "space already exists" }, 409);

  const normalizedExtraEnv = normalizeSpaceEnv(body.extraEnv);
  const envValidationError = validateSpaceEnvForResponse(normalizedExtraEnv);
  if (envValidationError) return c.json(envValidationError, 400);

  const normalizedChannelBindings = Array.isArray(body.channelBindings)
    ? body.channelBindings
        .filter((binding) => binding?.channelId && requireValidId(binding.channelId))
        .map((binding) => ({ channelId: binding.channelId, config: binding.config ?? null }))
    : [];

  if (normalizedChannelBindings.length > 0) {
    const ids = normalizedChannelBindings.map((binding) => binding.channelId);
    const channels = await db
      .select({ id: userChannels.id })
      .from(userChannels)
      .where(and(eq(userChannels.userUuid, user.uuid), inArray(userChannels.id, ids)));
    if (channels.length !== ids.length) return c.json({ message: "one or more channels are invalid" }, 400);
  }

  const occupiedChannels = normalizedChannelBindings.length
    ? await db
        .select({ channelId: spaceChannels.channelId })
        .from(spaceChannels)
        .where(inArray(spaceChannels.channelId, normalizedChannelBindings.map((binding) => binding.channelId)))
    : [];
  if (occupiedChannels.length > 0) {
    return c.json({ message: "channel binding already exists for this channel" }, 409);
  }

  let normalizedBootstrapSource:
    | { type: "blank" }
    | { type: "git_repo"; repoUrl: string; ref: string | null }
    | { type: "checkpoint"; checkpointId: string };
  const gitToken = body.gitHubToken?.trim() || c.req.header("X-Git-Token")?.trim() || null;
  try {
    normalizedBootstrapSource = (() => {
      const source = body.bootstrapSource;
      if (!source || source.type === "blank") return { type: "blank" } as const;
      if (source.type === "git_repo") {
        const repoUrl = source.repoUrl?.trim();
        if (!repoUrl) throw new Error("repoUrl is required");
        return { type: "git_repo", repoUrl, ref: source.ref?.trim() || null } as const;
      }
      if (source.type === "checkpoint") {
        const checkpointId = source.checkpointId?.trim();
        if (!checkpointId || !requireValidId(checkpointId)) throw new Error("checkpointId is required");
        return { type: "checkpoint", checkpointId } as const;
      }
      return { type: "blank" } as const;
    })();
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : String(error) }, 400);
  }

  if (normalizedBootstrapSource.type === "checkpoint") {
    const [checkpoint] = await db
      .select({ id: checkpoints.id })
      .from(checkpoints)
      .where(eq(checkpoints.id, normalizedBootstrapSource.checkpointId))
      .limit(1);
    if (!checkpoint) return c.json({ message: "checkpoint not found" }, 404);
  }

  const spaceId = crypto.randomUUID();
  const storageRepoName = buildStorageRepoName(spaceId);

  const [space] = await db
    .insert(spaces)
    .values({
      id: spaceId,
      userUuid: user.uuid,
      name,
      description: body.description ?? null,
      storageRepoName,
      baseCheckpointId: normalizedBootstrapSource.type === "checkpoint" ? normalizedBootstrapSource.checkpointId : null,
      headCheckpointId: null,
      meta: {
        ...(body.meta ?? {}),
        extraEnv: normalizedExtraEnv,
        bootstrap: {
          status: "pending",
          stage: null,
          taskRunId: null,
          errorMessage: null,
          source: normalizedBootstrapSource,
          startedAt: null,
          finishedAt: null,
        },
      },
    })
    .returning();

  if (!space) return c.json({ message: "failed to create space" }, 500);

  await db.insert(spaceMembers).values({
    spaceId: space.id,
    userId: user.uuid,
    role: "host",
    createdBy: user.uuid,
    updatedBy: user.uuid,
  });

  if (normalizedChannelBindings.length > 0) {
    const insertedChannels = await db
      .insert(spaceChannels)
      .values(
        normalizedChannelBindings.map((binding) => ({
          spaceId: space.id,
          channelId: binding.channelId,
          config: binding.config,
        })),
      )
      .returning();
    await Promise.all(
      insertedChannels.map((channel) =>
        syncSpaceChannelConfigCache({
          spaceChannelId: channel.id,
          config: (channel.config as Record<string, unknown> | null) ?? null,
        }),
      ),
    );
    // Push channel config to gateway so it starts long-polling
    void bindSpaceChannelsToGateway(space.id).catch(console.error);
  }

  const gitAccount = await ensureUserGitAccount(user.uuid);
  void reconcileSpaceSandbox(
    {
      ...getSpaceProvisionParams(user, space, gitAccount),
      mode: "ensure",
      reason: "space_created",
    },
  ).catch(console.error);

  const taskData: Record<string, unknown> = { source: normalizedBootstrapSource };
  // TODO: gitToken is stored in taskData (BullMQ Redis + DB task_runs).
  // For long-term security, encrypt it or use a temporary token reference.
  if (gitToken) taskData.gitToken = gitToken;

  const job = await enqueueTask({
    type: "create_space",
    spaceId: space.id,
    userId: user.uuid,
    data: taskData,
  }).catch(async (error) => {
    const nextMeta = {
      ...((space.meta as Record<string, unknown> | null) ?? {}),
      bootstrap: {
        status: "failed",
        stage: null,
        taskRunId: null,
        errorMessage: error instanceof Error ? error.message : String(error),
        source: normalizedBootstrapSource,
        startedAt: null,
        finishedAt: new Date().toISOString(),
      },
    };
    await db
      .update(spaces)
      .set({ meta: nextMeta, updatedAt: new Date() })
      .where(eq(spaces.id, space.id));
    throw error;
  });
  const taskRunId = job.taskRunId;
  if (!taskRunId) {
    await db
      .update(spaces)
      .set({
        meta: {
          ...((space.meta as Record<string, unknown> | null) ?? {}),
          bootstrap: {
            status: "failed",
            stage: null,
            taskRunId: null,
            errorMessage: "failed to allocate create_space task id",
            source: normalizedBootstrapSource,
            startedAt: null,
            finishedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(spaces.id, space.id));
    return c.json({ message: "failed to create bootstrap job" }, 500);
  }

  const [spaceWithJob] = await db
    .update(spaces)
    .set({
      meta: {
        ...((space.meta as Record<string, unknown> | null) ?? {}),
        bootstrap: {
          status: "pending",
          stage: null,
          taskRunId,
          errorMessage: null,
          source: normalizedBootstrapSource,
          startedAt: null,
          finishedAt: null,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(spaces.id, space.id))
    .returning();

  return c.json({ space: spaceWithJob ?? space, taskRunId });
});

// ── GET /api/spaces/:id ──────────────────────────────────────────────────────

function sanitizeRepoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function sanitizeSpaceMeta(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return meta as null;
  }
  const metaObj = meta as Record<string, unknown>;
  const bootstrap = metaObj.bootstrap;
  if (
    !bootstrap ||
    typeof bootstrap !== "object" ||
    Array.isArray(bootstrap)
  ) {
    return metaObj;
  }
  const bootstrapObj = bootstrap as Record<string, unknown>;
  const source = bootstrapObj.source;
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source)
  ) {
    return metaObj;
  }
  const sourceObj = source as Record<string, unknown>;
  if (sourceObj.type === "git_repo" && typeof sourceObj.repoUrl === "string") {
    return {
      ...metaObj,
      bootstrap: {
        ...bootstrapObj,
        source: {
          ...sourceObj,
          repoUrl: sanitizeRepoUrl(sourceObj.repoUrl as string),
        },
      },
    };
  }
  return metaObj;
}

async function getGiteaUsernameForUser(userUuid: string): Promise<string | null> {
  const [account] = await db
    .select({ giteaUsername: userGitAccounts.giteaUsername })
    .from(userGitAccounts)
    .where(
      and(
        eq(userGitAccounts.userUuid, userUuid),
        eq(userGitAccounts.provider, "gitea"),
      ),
    )
    .limit(1);
  return account?.giteaUsername ?? null;
}

router.get("/:id", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  if (await hasPermission(user, "space.view", { spaceId })) {
    const sandbox = await getSpaceSandboxBySpaceId(space.id);
    const sanitizedMeta = sanitizeSpaceMeta(space.meta);
    const profileMap = await getProfilesByUuids([space.userUuid]);
    const ownerProfile = profileMap.get(space.userUuid) ?? fallbackPublicUserProfile(space.userUuid);

    // Only include git info when the requester is the space creator
    let gitInfo: { giteaHost: string; giteaUsername: string } | undefined;
    if (user?.uuid === space.userUuid) {
      const giteaUsername = await getGiteaUsernameForUser(space.userUuid);
      if (giteaUsername) {
        gitInfo = {
          giteaHost: new URL(config.giteaBaseUrl).host,
          giteaUsername,
        };
      }
    }

    return c.json({
      ...space,
      meta: sanitizedMeta,
      sandboxStatus: sandbox?.status ?? null,
      sandbox: attachSandboxPublicEndpoints(sandbox),
      ownerProfile,
      gitInfo: gitInfo ?? null,
    });
  }

  // Fallback: only session-level access — return minimal info
  return c.json({
    id: space.id,
    name: space.name,
    accessLevel: "minimal" as const,
  });
});

// ── PATCH /api/spaces/:id (rename) ─────────────────────────────────────────

router.patch("/:id", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return c.json({ message: "name is required" }, 400);
  if (name === space.name) return c.json({ space });

  const duplicate = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.userUuid, user.uuid), eq(spaces.name, name)))
    .limit(1);
  if (duplicate.length > 0) return c.json({ message: "space name already exists" }, 409);

  const [updated] = await db
    .update(spaces)
    .set({ name, updatedAt: new Date() })
    .where(eq(spaces.id, spaceId))
    .returning();

  return c.json({ space: updated ?? space });
});

// ── PATCH /api/spaces/:id/profile ───────────────────────────────────────────

router.patch("/:id/profile", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ description?: string | null; pictureUrl?: string | null }>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);

  const existingMeta = (space.meta as Record<string, unknown> | null) ?? {};
  const existingProfile = typeof existingMeta.publicProfile === "object" && existingMeta.publicProfile !== null && !Array.isArray(existingMeta.publicProfile)
    ? existingMeta.publicProfile as Record<string, unknown>
    : {};
  const nextProfile = body.pictureUrl !== undefined
    ? { ...existingProfile, pictureUrl: body.pictureUrl?.trim() || null }
    : existingProfile;

  const [updated] = await db
    .update(spaces)
    .set({
      description: body.description !== undefined ? body.description : space.description,
      meta: { ...existingMeta, publicProfile: nextProfile },
      updatedAt: new Date(),
    })
    .where(eq(spaces.id, spaceId))
    .returning();

  return c.json({ space: updated ?? space });
});

// ── Checkpoints ──────────────────────────────────────────────────────────────

router.post("/:id/checkpoints", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "checkpoint.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ description?: string }>().catch(() => null);
  const description = body?.description?.trim() || null;

  if (space.name === "config") {
    const duplicateConfigSpaces = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.userUuid, space.userUuid), eq(spaces.name, "config")))
      .limit(2);
    if (duplicateConfigSpaces.length > 1) {
      return c.json({ message: "multiple config spaces found for this user" }, 409);
    }
  }

  const { taskRunId } = await enqueueTask({
    type: "save_checkpoint",
    spaceId,
    userId: user.uuid,
    data: { spaceId, description },
  });

  return c.json({ ok: true, taskRunId });
});

router.get("/:id/checkpoints", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "checkpoint.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const rows = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.spaceId, spaceId))
    .orderBy(desc(checkpoints.createdAt))
    .limit(100);

  return c.json({ checkpoints: rows });
});

router.get("/:id/checkpoints/:checkpointId", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  const checkpointId = c.req.param("checkpointId");
  if (!requireValidId(spaceId) || !requireValidId(checkpointId)) {
    return c.json({ message: "checkpoint not found" }, 404);
  }
  if (!(await hasPermission(user, "checkpoint.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const [checkpoint] = await db
    .select()
    .from(checkpoints)
    .where(and(eq(checkpoints.id, checkpointId), eq(checkpoints.spaceId, spaceId)))
    .limit(1);

  if (!checkpoint) return c.json({ message: "checkpoint not found" }, 404);

  return c.json({ checkpoint });
});

// ── Env ──────────────────────────────────────────────────────────────────────

function getExtraEnvFromSpace(space: typeof spaces.$inferSelect) {
  const meta = space.meta as Record<string, unknown> | null;
  return normalizeSpaceEnv(meta?.extraEnv);
}

async function persistSpaceEnv(space: typeof spaces.$inferSelect, envs: Array<{ name: string; value: string }>) {
  const existingMeta = space.meta as Record<string, unknown> | null;
  await db
    .update(spaces)
    .set({
      meta: { ...existingMeta, extraEnv: envs },
      updatedAt: new Date(),
    })
    .where(eq(spaces.id, space.id));
  await setSpaceEnv(space.id, envs);
}

router.get("/:id/env", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  const envs = getExtraEnvFromSpace(space);
  return c.json({ env: envs });
});

const toSpaceEnvValidationResponse = (error: unknown) => {
  if (!(error instanceof SpaceEnvValidationError)) return null;
  return { message: error.message };
};

const validateSpaceEnvForResponse = (envs: Array<{ name: string; value: string }>) => {
  try {
    validateSpaceEnv(envs);
    return null;
  } catch (error) {
    const response = toSpaceEnvValidationResponse(error);
    if (response) return response;
    throw error;
  }
};

router.post("/:id/env", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ name: string; value: string }>().catch(() => null);
  if (!body?.name || body.value === undefined) return c.json({ message: "name and value are required" }, 400);

  const entry = { name: body.name.trim(), value: String(body.value) };
  if (SYSTEM_ENV_KEY_SET.has(entry.name)) {
    return c.json({ message: `env name "${entry.name}" is reserved by the system` }, 400);
  }

  const existing = getExtraEnvFromSpace(space);
  const filtered = existing.filter((e) => e.name !== entry.name);
  const updated = [...filtered, entry];
  const validationError = validateSpaceEnvForResponse(updated);
  if (validationError) return c.json(validationError, 400);
  await persistSpaceEnv(space, updated);

  return c.json({ env: updated }, 201);
});

router.put("/:id/env/:name", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const envName = c.req.param("name");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  if (!envName?.trim()) return c.json({ message: "env name is required" }, 400);
  if (SYSTEM_ENV_KEY_SET.has(envName)) {
    return c.json({ message: `env name "${envName}" is reserved by the system` }, 400);
  }

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ value?: string }>().catch(() => null);
  if (!body || body.value === undefined || body.value === null) return c.json({ message: "value is required" }, 400);

  const existing = getExtraEnvFromSpace(space);
  const target = existing.find((e) => e.name === envName);
  if (!target) return c.json({ message: `env "${envName}" not found` }, 404);

  target.value = String(body.value);
  const validationError = validateSpaceEnvForResponse(existing);
  if (validationError) return c.json(validationError, 400);
  await persistSpaceEnv(space, existing);

  return c.json({ env: existing });
});

router.delete("/:id/env/:name", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const envName = c.req.param("name");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "space.edit", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  const existing = getExtraEnvFromSpace(space);
  const filtered = existing.filter((e) => e.name !== envName);
  if (filtered.length === existing.length) return c.json({ message: `env "${envName}" not found` }, 404);

  await persistSpaceEnv(space, filtered);
  return c.json({ env: filtered });
});

// ── Sandbox ──────────────────────────────────────────────────────────────────

router.get("/:id/sandbox", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "sandbox.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  return c.json({ sandbox: attachSandboxPublicEndpoints(sandbox) });
});

router.get("/:id/sandbox/ports", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "sandbox.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  return c.json({ endpoints: attachSandboxPublicEndpoints(sandbox)?.publicEndpoints ?? {} });
});

router.post("/:id/sandbox/recreate", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "sandbox.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const result = await recoverSpaceSandbox({
    ...getSpaceProvisionParams(user, space, gitAccount),
    reason: "manual_recreate",
    source: "manual",
    verify: true,
  });

  return c.json(result);
});

// ── Sessions ─────────────────────────────────────────────────────────────────

router.post("/:id/prompt", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "session.prompt.fullaccess", { spaceId }))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<SpacePromptInput>().catch(() => null);
  if (!validatePromptContentBlocks(body?.content)) {
    return c.json({ message: "content is required and must be a non-empty ContentBlock array" }, 400);
  }
  if (body.sessionId && !requireValidId(body.sessionId)) return c.json({ message: "invalid sessionId" }, 400);

  let sessionId = body.sessionId?.trim() || null;
  if (sessionId) {
    const session = await getSpaceSessionById(sessionId);
    if (!session || session.spaceId !== spaceId) return c.json({ message: "session not found" }, 404);
    if (!(await hasPermission(user, "session.prompt.fullaccess", { spaceId, sessionId }))) {
      return c.json({ message: "not found" }, 404);
    }
  }

  const schedule = body.schedule ?? { mode: "immediate" as const };
  const mode = schedule.mode ?? "immediate";
  if (!["immediate", "delay", "at", "repeat"].includes(mode)) {
    return c.json({ message: "schedule.mode must be one of: immediate, delay, at, repeat" }, 400);
  }

  const content = body.content;
  const clientMessageId = body.clientMessageId?.trim() || crypto.randomUUID();

  const taskData = {
    content,
    ...(sessionId ? { sessionId } : {}),
    ...(body.title ? { title: body.title } : {}),
    ...(body.model ? { model: body.model } : {}),
    ...(body.provider ? { provider: body.provider } : {}),
  };

  if (mode === "immediate") {
    if (!sessionId) {
      const session = await createInitialSpaceSession({
        spaceId,
        sessionId: crypto.randomUUID(),
        title: body.title ?? null,
        source: "public_api",
        externalSessionId: null,
        meta: { createdBy: "api_space_prompt" },
      });
      sessionId = session.id;
    }

    try {
      const result = await submitSessionPrompt({
        spaceId,
        sessionId,
        userId: user.uuid,
        clientMessageId,
        content,
        source: "public_api",
        model: body.model ?? null,
        provider: body.provider ?? null,
        context: { kind: "public_api" },
      });
      return c.json({ ok: true, mode: "immediate", sessionId, ...result });
    } catch (error) {
      if (error instanceof SandboxNotReadyError) return c.json({ message: "sandbox is not ready" }, 503);
      const inputError = promptInputError(error);
      if (inputError) return c.json({ message: inputError }, 400);
      throw error;
    }
  }

  if (mode === "delay") {
    const delayMs = Number((schedule as { delayMs?: number }).delayMs);
    if (!isPositiveSafeInteger(delayMs)) {
      return c.json({ message: "delayMs must be a positive safe integer of milliseconds, e.g. 600000" }, 400);
    }
    const scheduledAt = new Date(Date.now() + delayMs);
    const { taskRunId } = await enqueueTask({
      type: "send_message",
      spaceId,
      sessionId: sessionId ?? undefined,
      userId: user.uuid,
      data: taskData,
    }, { delay: delayMs, scheduledAt });
    return c.json({ ok: true, mode: "delay", taskRunId, scheduledAt: scheduledAt.toISOString(), sessionId });
  }

  if (mode === "at") {
    const sendAt = (schedule as { sendAt?: string }).sendAt;
    if (!sendAt?.trim()) return c.json({ message: "sendAt is required, e.g. 2026-05-09T10:00:00+08:00" }, 400);
    let scheduledAt: Date;
    try {
      scheduledAt = parseScheduledAt(sendAt);
    } catch (error) {
      return c.json({ message: error instanceof Error ? error.message : String(error) }, 400);
    }
    const { taskRunId } = await enqueueTask({
      type: "send_message",
      spaceId,
      sessionId: sessionId ?? undefined,
      userId: user.uuid,
      data: taskData,
    }, { delay: scheduledAt.getTime() - Date.now(), scheduledAt });
    return c.json({ ok: true, mode: "at", taskRunId, scheduledAt: scheduledAt.toISOString(), sessionId });
  }

  const repeat = schedule as { cronExpression?: string; timezone?: string };
  if (!repeat.cronExpression?.trim()) return c.json({ message: "cronExpression is required, e.g. 0 9 * * *" }, 400);
  if (!repeat.timezone?.trim()) return c.json({ message: "timezone is required, e.g. Asia/Shanghai" }, 400);
  let parsedRepeat: { cronExpression: string; timezone: string; nextRun: Date };
  try {
    parsedRepeat = validateRepeatSchedule({ cronExpression: repeat.cronExpression, timezone: repeat.timezone });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : String(error) }, 400);
  }

  const cronJob = await createCronJob({
    userId: user.uuid,
    title: body.title?.trim() || "Scheduled prompt",
    taskType: "send_message",
    payload: taskData,
    schedule: { pattern: parsedRepeat.cronExpression, timezone: parsedRepeat.timezone },
    spaceId,
    sessionId,
  });

  return c.json({
    ok: true,
    mode: "repeat",
    cronJobId: cronJob.id,
    nextRunAt: parsedRepeat.nextRun.toISOString(),
    timezone: parsedRepeat.timezone,
    sessionId,
  });
});

router.post("/:id/sessions", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "session.prompt.fullaccess", { spaceId }))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const body = await c.req.json<{ title?: string; source?: string }>().catch(() => ({
    title: undefined,
    source: undefined,
  }));

  const session = await createInitialSpaceSession({
    spaceId: space.id,
    sessionId: crypto.randomUUID(),
    title: body.title ?? null,
    source: body.source ?? null,
    externalSessionId: null,
    meta: { createdBy: "api_space_session_create" },
  });

  return c.json({ ok: true, session });
});

router.get("/:id/sessions", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const limitParam = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(limitParam) ? limitParam : 20;
  const cursor = c.req.query("cursor") ?? null;
  const { sessions, pageInfo } = await listSpaceSessions(spaceId, { limit, cursor });

  // Member users have space-level permission that covers all sessions.
  // Only non-members need per-session accessPolicy checks.
  const isMember = user?.uuid
    ? (await getSpaceMemberRole(spaceId, user.uuid)) !== null
    : false;
  const visibleSessions = isMember
    ? sessions
    : await filterSessionsByPermission(user, "session.view", spaceId, sessions);

  const includeForks = c.req.query("includeForks") === "1" || c.req.query("includeForks") === "true";
  const forks = includeForks
    ? (await listSessionForksForSessions(visibleSessions.map((session) => session.id))).map((fork) => {
      if (isMember) return fork;
      const visibleSessionIds = new Set(visibleSessions.map((session) => session.id));
      const parentVisible = visibleSessionIds.has(fork.parentSessionId);
      return {
        id: fork.id,
        spaceId: fork.spaceId,
        childSessionId: fork.childSessionId,
        parentSessionId: parentVisible ? fork.parentSessionId : null,
        depth: fork.depth,
        anchorSequence: fork.anchorSequence,
        createdAt: fork.createdAt,
        firstUserTextAfterFork: fork.firstUserTextAfterFork,
        parentTitle: parentVisible ? fork.parentTitle : null,
      };
    })
    : undefined;

  return c.json({ sessions: visibleSessions, ...(forks ? { forks } : {}), pageInfo });
});

// ── Channels ─────────────────────────────────────────────────────────────────

router.get("/:id/channels", async (c) => {
  const user = getOptionalAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "channel.view", { spaceId }))) return c.json({ message: "space not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const channels = await getSpaceChannelsBySpaceId(space.id);
  const channelIds = channels.map((item) => item.channelId);
  const channelList =
    channelIds.length > 0
      ? await db.select().from(userChannels).where(inArray(userChannels.id, channelIds))
      : [];

  const userChannelById = new Map(channelList.map((item) => [item.id, item]));

  return c.json(
    channels.map((channel) => ({
      ...channel,
      channel: userChannelById.get(channel.channelId) ?? null,
    })),
  );
});

// ── POST /api/spaces/:id/channels/:channelId — bind a channel at runtime ─────────────────

router.post("/:id/channels/:channelId", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const channelId = c.req.param("channelId");
  if (!requireValidId(spaceId) || !requireValidId(channelId)) {
    return c.json({ message: "space or channel not found" }, 404);
  }
  if (!(await hasPermission(user, "channel.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  // Verify ownership: the channel must belong to the same user
  const [userChannel] = await db.select().from(userChannels).where(and(eq(userChannels.id, channelId), eq(userChannels.userUuid, user.uuid))).limit(1);
  if (!userChannel) return c.json({ message: "channel not found or not owned by you" }, 404);

  // Check if already bound to any space
  const [existingBinding] = await db.select({ id: spaceChannels.id }).from(spaceChannels).where(eq(spaceChannels.channelId, channelId)).limit(1);
  if (existingBinding) return c.json({ message: "channel is already bound to another space" }, 409);

  const body = (await c.req.json<{ config?: Record<string, unknown> | null }>().catch(() => ({}))) as { config?: Record<string, unknown> | null };

  const [spaceChannel] = await db.insert(spaceChannels).values({
    spaceId,
    channelId,
    config: body.config ?? null,
  }).returning();

  if (!spaceChannel) return c.json({ message: "failed to bind channel" }, 500);

  // Push to gateway so it starts listening (bindSingleChannelToGateway handles config cache internally)
  void bindSpaceChannelsToGateway(spaceId).catch(console.error);

  return c.json(spaceChannel, 201);
});

// ── DELETE /api/spaces/:id/channels/:channelId — unbind a channel at runtime ─────────────

router.delete("/:id/channels/:channelId", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  const channelId = c.req.param("channelId");
  if (!requireValidId(spaceId) || !requireValidId(channelId)) {
    return c.json({ message: "space or channel not found" }, 404);
  }
  if (!(await hasPermission(user, "channel.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const [spaceChannel] = await db.select().from(spaceChannels).where(and(eq(spaceChannels.spaceId, spaceId), eq(spaceChannels.channelId, channelId))).limit(1);
  if (!spaceChannel) return c.json({ message: "channel not bound to this space" }, 404);

  await db.delete(spaceChannels).where(eq(spaceChannels.id, spaceChannel.id));
  // Remove from gateway routing
  void unbindSpaceChannelFromGateway(spaceChannel.id).catch(console.error);

  return c.json({ ok: true });
});

export default router;

