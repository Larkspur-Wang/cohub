import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  userChannels,
  spaceChannels,
  spaces,
  spaceMembers,
} from "../../db/schema-v2.js";
import { eq, and, inArray, desc } from "drizzle-orm";
import { useAuth, requireValidId, buildSpaceListItems, buildStorageRepoName } from "../../lib/middleware.js";
import { ensureUserGitAccount } from "../../git-accounts.js";
import { getSpaceSandboxBySpaceId, reconcileSpaceSandbox } from "../../space-sandboxes.js";
import {
  createInitialSpaceSession,
  getSpaceById,
  listSpaceSessions,
  normalizeSpaceEnv,
  validateSpaceEnv,
} from "../../space-sessions.js";
import { syncSpaceChannelConfigCache, getSpaceChannelsBySpaceId } from "../../channels.js";
import { enqueueTask } from "../../tasks.js";
import { hasPermission, getSpaceMemberRole, filterSessionsByPermission } from "../../permissions.js";
import { checkpoints } from "../../db/schema-v2.js";
import type { AuthUser } from "../../lib/middleware.js";

type GitAccount = Awaited<ReturnType<typeof ensureUserGitAccount>>;

const router = new Hono();

// ── Provisioning params builder ──────────────────────────────────────────────

function getSpaceProvisionParams(
  user: AuthUser,
  space: typeof spaces.$inferSelect,
  _gitAccount: GitAccount,
  extraEnv?: Array<{ name: string; value: string }>,
) {
  return {
    spaceId: space.id,
    userUuid: user.uuid,
    extraEnv,
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
  validateSpaceEnv(normalizedExtraEnv);

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
  }

  const gitAccount = await ensureUserGitAccount(user.uuid);
  void reconcileSpaceSandbox(
    {
      ...getSpaceProvisionParams(user, space, gitAccount, normalizedExtraEnv),
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

router.get("/:id", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space) return c.json({ message: "space not found" }, 404);

  if (await hasPermission(user, "space.view", { spaceId })) {
    const sandbox = await getSpaceSandboxBySpaceId(space.id);
    return c.json({ ...space, sandboxStatus: sandbox?.status ?? null });
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

// ── Checkpoints ──────────────────────────────────────────────────────────────

router.post("/:id/checkpoints", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "checkpoint.edit", { spaceId }))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ description?: string }>().catch(() => null);
  const description = body?.description?.trim() || null;

  const { taskRunId } = await enqueueTask({
    type: "save_checkpoint",
    spaceId,
    userId: user.uuid,
    data: { spaceId, description },
  });

  return c.json({ ok: true, taskRunId });
});

router.get("/:id/checkpoints", async (c) => {
  const user = useAuth(c);
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
  const user = useAuth(c);
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

// ── Sandbox ──────────────────────────────────────────────────────────────────

router.get("/:id/sandbox", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "sandbox.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  return c.json({ sandbox: sandbox ?? null });
});

router.post("/:id/sandbox/recreate", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "sandbox.manage", { spaceId }))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  void reconcileSpaceSandbox({
    ...getSpaceProvisionParams(user, space, gitAccount),
    mode: "replace",
    reason: "manual_recreate",
  }).catch(console.error);

  return c.json({ ok: true, message: "Sandbox recreation triggered" });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

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
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await hasPermission(user, "session.view", { spaceId }))) return c.json({ message: "not found" }, 404);

  const sessions = await listSpaceSessions(spaceId);

  // Member users have space-level permission that covers all sessions.
  // Only non-members need per-session accessPolicy checks.
  const isMember = user?.uuid
    ? (await getSpaceMemberRole(spaceId, user.uuid)) !== null
    : false;
  const visibleSessions = isMember
    ? sessions
    : await filterSessionsByPermission(user, "session.view", spaceId, sessions);

  return c.json({ sessions: visibleSessions });
});

// ── Channels ─────────────────────────────────────────────────────────────────

router.get("/:id/channels", async (c) => {
  const user = useAuth(c);
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

export default router;

