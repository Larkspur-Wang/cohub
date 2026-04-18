import { Hono } from "hono";
import { db } from "../../db/index.js";
import {
  userChannels,
  resourcePermissions,
  spaceChannels,
  spaces,
} from "../../db/schema-v2.js";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuth, useAuth, requireValidId, buildSpaceListItem, buildStorageRepoName } from "../../lib/middleware.js";
import { k8sCoreApi } from "../../k8s.js";
import { sessionsNamespace, config } from "../../config.js";
import { ensureUserGitAccount } from "../../git-accounts.js";
import { createRepository } from "../../gitea.js";
import { getSpaceSandboxBySpaceId, provisionSpaceInBackground, updateSpaceSandbox } from "../../space-sandboxes.js";
import {
  createInitialSpaceSession,
  getSpaceById,
  getSpaceSessionById,
  listSpaceSessions,
  normalizeSpaceEnv,
  validateSpaceEnv,
} from "../../space-sessions.js";
import { syncSpaceChannelConfigCache, getSpaceChannelsBySpaceId } from "../../channels.js";
import { enqueueTask } from "../../tasks.js";
import { canRead, canReadForSession, canWrite } from "../../permissions.js";
import { checkpoints } from "../../db/schema-v2.js";
import type { AuthUser } from "../../lib/middleware.js";

type GitAccount = Awaited<ReturnType<typeof ensureUserGitAccount>>;

const router = new Hono();

// ── Provisioning params builder ──────────────────────────────────────────────

function getSpaceProvisionParams(
  user: AuthUser,
  space: typeof spaces.$inferSelect,
  gitAccount: GitAccount,
  extraEnv?: Array<{ name: string; value: string }>,
) {
  const storageRepoName = buildStorageRepoName(space.id);
  return {
    spaceId: space.id,
    userUuid: user.uuid,
    spaceRepoUrl: `https://${gitAccount.giteaUsername}:${gitAccount.giteaAccessToken}@gitea.cohub.run/${gitAccount.giteaUsername}/${storageRepoName}.git`,
    spaceGitUsername: gitAccount.giteaUsername,
    spaceGitEmail: `${gitAccount.giteaUsername}@${config.giteaManagedEmailDomain}`,
    extraEnv,
  };
}

// ── GET /api/spaces ──────────────────────────────────────────────────────────

router.get("/", async (c) => {
  const user = useAuth(c);

  const spaceList = await db
    .select()
    .from(spaces)
    .where(eq(spaces.userUuid, user.uuid))
    .orderBy(desc(spaces.updatedAt), desc(spaces.createdAt));

  const items = await Promise.all(spaceList.map((space) => buildSpaceListItem(space)));
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
  };

  const name = body.name?.trim();
  if (!name) return c.json({ message: "name is required" }, 400);

  const existingSpace = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.userUuid, user.uuid), eq(spaces.name, name)))
    .limit(1);
  if (existingSpace.length > 0) return c.json({ message: "space already exists" }, 409);

  const spaceId = crypto.randomUUID();
  const storageRepoName = buildStorageRepoName(spaceId);

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const repo = await createRepository(gitAccount.giteaAccessToken, storageRepoName, true).catch(
    (error) => error as Error,
  );
  if (repo instanceof Error) return c.json({ message: repo.message }, 500);

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
  if (occupiedChannels.length > 0)
    return c.json({ message: "channel binding already exists for this channel" }, 409);

  const [space] = await db
    .insert(spaces)
    .values({
      id: spaceId,
      userUuid: user.uuid,
      name,
      description: body.description ?? null,
      storageRepoName,
      baseCheckpointId: null,
      headCheckpointId: null,
      meta: {
        ...(body.meta ?? {}),
        extraEnv: normalizedExtraEnv,
      },
    })
    .returning();

  if (!space) return c.json({ message: "failed to create space" }, 500);

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

  void provisionSpaceInBackground(
    getSpaceProvisionParams(user, space, gitAccount, normalizedExtraEnv),
  ).catch(console.error);

  return c.json({ space });
});

// ── GET /api/spaces/:id ──────────────────────────────────────────────────────

router.get("/:id", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(space.id);
  return c.json({ ...space, sandboxStatus: sandbox?.status ?? null });
});

// ── Checkpoints ──────────────────────────────────────────────────────────────

router.post("/:id/checkpoints", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ description?: string }>().catch(() => null);
  const description = body?.description?.trim() || null;

  const job = await enqueueTask({
    type: "save_checkpoint",
    spaceId,
    userId: user.uuid,
    data: { spaceId, description },
  });

  return c.json({ ok: true, jobId: job.id });
});

router.get("/:id/checkpoints", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canRead(user, spaceId))) return c.json({ message: "not found" }, 404);

  const rows = await db
    .select()
    .from(checkpoints)
    .where(eq(checkpoints.spaceId, spaceId))
    .orderBy(desc(checkpoints.createdAt))
    .limit(100);

  return c.json({ checkpoints: rows });
});

// ── Sandbox ──────────────────────────────────────────────────────────────────

router.get("/:id/sandbox", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  return c.json({ sandbox: sandbox ?? null });
});

router.post("/:id/sandbox/recreate", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const existingSandbox = await getSpaceSandboxBySpaceId(spaceId);
  const podName = existingSandbox?.podName ?? `sandbox-${spaceId}`;

  if (existingSandbox?.podName) {
    await Promise.allSettled([
      k8sCoreApi.deleteNamespacedPod({ name: podName, namespace: sessionsNamespace }),
      k8sCoreApi.deleteNamespacedService({ name: podName, namespace: sessionsNamespace }),
    ]);
  }

  await updateSpaceSandbox({
    spaceId,
    status: "provisioning",
    meta: { recreatedAt: new Date().toISOString() },
  });

  const gitAccount = await ensureUserGitAccount(user.uuid);
  void provisionSpaceInBackground(getSpaceProvisionParams(user, space, gitAccount)).catch(
    console.error,
  );

  return c.json({ ok: true, message: "Sandbox recreation triggered" });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

router.post("/:id/sessions", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);
  if (!(await canWrite(user, spaceId))) return c.json({ message: "not found" }, 404);

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
  if (!(await canRead(user, spaceId))) return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space) return c.json({ message: "space not found" }, 404);

  const sessions = await listSpaceSessions(space.id);
  const permissions = await db
    .select()
    .from(resourcePermissions)
    .where(inArray(resourcePermissions.resourceId, [spaceId, ...sessions.map((s) => s.id)]));

  const sessionShareLevels = new Map(
    permissions
      .filter((p) => p.resourceType === "session")
      .map((p) => [p.resourceId, p.level]),
  );

  const isOwner = user.uuid === space.userUuid;
  const isCollaborator =
    !isOwner &&
    permissions.some(
      (p) => p.resourceType === "space" && p.resourceId === spaceId && p.granteeUuid === user.uuid,
    );

  const visibleSessions = isOwner || isCollaborator
    ? sessions
    : (
        await Promise.all(
          sessions.map(async (s) =>
            (await canReadForSession(user, spaceId, s.id)) ? s : null,
          ),
        )
      ).filter((s): s is NonNullable<typeof s> => Boolean(s));

  return c.json({ space, sessions: visibleSessions.map((session) => ({
      ...session,
      shareLevel: sessionShareLevels.get(session.id) ?? null,
    })),
  });
});

// ── Channels ─────────────────────────────────────────────────────────────────

router.get("/:id/channels", async (c) => {
  const user = useAuth(c);
  const spaceId = c.req.param("id");
  if (!requireValidId(spaceId)) return c.json({ message: "space not found" }, 404);

  const space = await getSpaceById(spaceId);
  if (!space || space.userUuid !== user.uuid) return c.json({ message: "space not found" }, 404);

  const channels = await getSpaceChannelsBySpaceId(space.id);
  const channelIds = channels.map((item) => item.channelId);
  const channelList =
    channelIds.length > 0
      ? await db
          .select()
          .from(userChannels)
          .where(and(eq(userChannels.userUuid, user.uuid), inArray(userChannels.id, channelIds)))
      : [];

  const userChannelById = new Map(channelList.map((item) => [item.id, item]));

  return c.json(
    channels.map((channel) => ({
      ...channel,
      channel: userChannelById.get(channel.channelId) ?? null,
    })),
  );
});

// ── GET /api/sessions/:id (standalone session lookup) ────────────────────────

router.get("/sessions/:id", async (c) => {
  const user = useAuth(c);
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);

  const session = await getSpaceSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  if (!(await canReadForSession(user, session.spaceId, session.id)))
    return c.json({ message: "not found" }, 404);

  const space = await getSpaceById(session.spaceId);
  if (!space) return c.json({ message: "session not found" }, 404);

  return c.json({ space, session, user });
});

export default router;
