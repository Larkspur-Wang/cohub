import "dotenv/config";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import { Hono, type Context } from "hono";

import {
  clearTokenCookie,
  fetchAuthUser,
  getTokenFromRequest,
  setTokenCookie,
} from "./auth.js";
import { assertRequiredConfig, config } from "./config.js";
import {
  getDirectoryEntries,
  getFileContent,
  getRepository,
  createRepository,
  addSshKey,
  createAnonymousRepository,
  addDeployKeyToRepo,
  forkRepository,
  updateRepositoryVisibility,
  deleteRepository,
} from "./gitea.js";
import { ensureUserGitAccount } from "./git-accounts.js";
import type {
  PersistMessageInput,
  PersistSessionInfoUpdateInput,
  RegisterRuntimeSessionInput,
} from "@cohub/protocol";
import {
  createRuntime,
  createInitialRuntimeSession,
  createUserMessageNode,
  enqueueRuntimePrompt,
  forkRuntimeSession,
  getRuntimeById,
  getRuntimeProvision,
  getRuntimeSessionBootstrap,
  getRuntimeSessionById,
  getRuntimeSessionGraph,
  listRuntimeSessions,
  listSessionMessages,
  listToolCallsByMessageIds,
  normalizeRuntimeEnv,
  persistMessageNode,
  provisionRuntimeInBackground,
  readRuntimeOutputStream,
  registerRuntimeSession,
  updateProviderRenderForSession,
  updateRuntimeSessionInfo,
  validateRuntimeEnv,
  writeInitialRuntimeProvision,
} from "./runtime-sessions.js";
import { db } from "./db/index.js";
import { userChannels, userGitAccounts, workspaces, runtimeChannels, runtimes } from "./db/schema.js";
import { eq, and, inArray, isNull, desc, sql } from "drizzle-orm";
import { handleInboundEvent, getBindingsByRuntimeId } from "./channels.js";
import { startGatewayLogConsumer } from "./gateway-logs.js";
import { createBlockingRedisClient, isRedisReady } from "./redis.js";
import type { GatewayInboundEvent } from "@cohub/protocol";
import { normalizeWorkspaceSlug } from "@cohub/protocol";

const buildWorkspaceListItem = (workspace: typeof workspaces.$inferSelect) => ({
  ...workspace,
  ownerUserUuid: workspace.userUuid,
});

const buildWorkspaceForkInfo = async (parentId: string | null) => {
  if (!parentId) return null;

  const [parentWs] = await db.select().from(workspaces).where(eq(workspaces.id, parentId)).limit(1);
  if (!parentWs) return null;

  const [parentGitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, parentWs.userUuid))
    .limit(1);

  return {
    id: parentWs.id,
    name: parentWs.name,
    ownerUserUuid: parentWs.userUuid,
    ownerUsername: parentGitAccount?.giteaUsername || null,
  };
};

const buildWorkspaceDetail = async (
  workspace: typeof workspaces.$inferSelect,
  options?: { currentUserUuid?: string | null },
) => {
  const [gitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, workspace.userUuid))
    .limit(1);
  if (!gitAccount?.giteaUsername) return null;

  const repoData = await getRepository(gitAccount.giteaUsername, workspace.giteaRepoName);
  if (!repoData) return null;

  const forkedFrom = await buildWorkspaceForkInfo(workspace.parentId ?? null);

  return {
    ...buildWorkspaceListItem(workspace),
    ownerUsername: gitAccount.giteaUsername,
    cloneUrl: "clone_url" in repoData ? String(repoData.clone_url) : null,
    sshUrl: "ssh_url" in repoData ? String(repoData.ssh_url) : null,
    htmlUrl: "html_url" in repoData ? String(repoData.html_url) : null,
    fullName: "full_name" in repoData ? String(repoData.full_name) : null,
    forkedFrom,
    isOwner: workspace.userUuid === options?.currentUserUuid,
  };
};

const startGatewayInboundListener = async () => {
  let lastId = "$";
  const client = createBlockingRedisClient();

  await client.connect().catch(() => undefined);
  console.log("[Channels] API Gateway Inbound Listener started.");
  while (true) {
    try {
      const result = await client.xread("BLOCK", 0, "STREAMS", "stream:gateway:inbound", lastId);
      if (!result) continue;
      for (const [, messages] of result) {
        for (const [id, fields] of messages) {
          lastId = id;
          const payloadIndex = fields.findIndex((f) => f === "payload");
          if (payloadIndex !== -1) {
            const payload = fields[payloadIndex + 1];
            if (!payload) continue;
            const event = JSON.parse(payload) as GatewayInboundEvent;
            await handleInboundEvent(event).catch(console.error);
          }
        }
      }
    } catch (e) {
      console.error("[Channels] Error reading gateway inbound stream:", e);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

startGatewayInboundListener().catch(console.error);
startGatewayLogConsumer().catch(console.error);

type Variables = { token: string | null };
const app = new Hono<{ Variables: Variables }>();

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const requireValidId = (id: string) => isUuid(id);
const ensureInternalRequest = (c: Context<{ Variables: Variables }>) => {
  const remoteAddr =
    c.req.header("x-forwarded-for") ??
    c.req.header("x-real-ip") ??
    c.req.header("cf-connecting-ip") ??
    "";
  if (
    remoteAddr &&
    !remoteAddr.startsWith("10.") &&
    !remoteAddr.startsWith("172.") &&
    !remoteAddr.startsWith("192.168.") &&
    remoteAddr !== "127.0.0.1" &&
    remoteAddr !== "::1"
  ) {
    return c.json({ message: "forbidden" }, 403);
  }
  return null;
};

app.use("*", async (c, next) => {
  c.set("token", getTokenFromRequest(c));
  await next();
});

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return config.webOrigin ?? "*";
      if (!config.webOrigin) return origin;
      return origin === config.webOrigin ? origin : config.webOrigin;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "neta-token", "Authorization"],
    credentials: true,
  }),
);

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/readyz", async (c) => {
  const redisReady = await isRedisReady();
  if (!redisReady) {
    return c.json({ ok: false, redis: false }, 503);
  }
  return c.json({ ok: true, redis: true });
});

app.post("/api/auth/token", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null);
  const token = body?.token?.trim();
  if (!token) return c.json({ message: "token is required" }, 400);
  const user = await fetchAuthUser(token).catch((error: unknown) => error);
  if (!user || user instanceof Error) {
    return c.json({ message: "invalid token" }, 401);
  }
  setTokenCookie(c, token);
  return c.json({ user });
});

app.delete("/api/auth/token", (c) => {
  clearTokenCookie(c);
  return c.body(null, 204);
});

app.get("/api/me", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user) {
    clearTokenCookie(c);
    return c.json({ message: "unauthorized" }, 401);
  }
  return c.json(user);
});

app.get("/v1/user/", async (c) => {
  const token = c.req.header("neta-token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user) return c.json({ message: "unauthorized" }, 401);
  return c.json(user);
});

app.post("/api/v1/user/repos", async (c) => {
  const token = c.req.header("neta-token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const body = await c.req.json<{ name: string; private?: boolean }>();
  try {
    const repo = await createRepository(token, body.name, body.private ?? true);
    return c.json(repo);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/api/v1/user/keys", async (c) => {
  const token = c.req.header("neta-token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const body = await c.req.json<{ key: string; title: string }>();
  try {
    const key = await addSshKey(token, body.key, body.title);
    return c.json(key);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/api/v1/share/init", async (c) => {
  try {
    const body = await c.req.json<{ name?: string; publicKey: string }>();
    const name = (body.name || "ws-share").toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    if (!body.publicKey || typeof body.publicKey !== "string") {
      return c.json({ message: "publicKey is required" }, 400);
    }
    const suffix = Math.random().toString(36).slice(2, 8);
    const repoName = `${name}-${suffix}`;
    const repo = await createAnonymousRepository(repoName);
    const owner = repo.owner.username;
    await addDeployKeyToRepo(owner, repo.name, body.publicKey, `ws-share-${suffix}`);
    return c.json({ owner, repo: repo.name, clone_url: null, ssh_url: repo.ssh_url });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/api/channels", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const channels = await db.select().from(userChannels).where(eq(userChannels.userUuid, user.uuid));
  return c.json(channels);
});

app.post("/api/channels", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const body = await c.req.json<{ provider: string; name: string; credentials: Record<string, unknown> }>();
  const [channel] = await db.insert(userChannels).values({
    userUuid: user.uuid,
    provider: body.provider,
    name: body.name,
    credentials: body.credentials,
  }).returning();
  return c.json(channel);
});

app.delete("/api/channels/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const id = c.req.param("id");
  await db.delete(userChannels).where(and(eq(userChannels.id, id), eq(userChannels.userUuid, user.uuid)));
  return c.json({ ok: true });
});

app.get("/api/workspaces", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const items = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userUuid, user.uuid))
    .orderBy(desc(workspaces.updatedAt), desc(workspaces.createdAt));

  return c.json(items.map(buildWorkspaceListItem));
});

app.post("/api/workspaces", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const body = await c.req
    .json<{
      name?: string;
      description?: string;
      private?: boolean;
    }>()
    .catch(() => null);

  const name = body?.name?.trim();
  if (!name) return c.json({ message: "name is required" }, 400);

  const repoSlug = normalizeWorkspaceSlug(name);
  if (!repoSlug) {
    return c.json({ message: "workspace name must contain letters or numbers" }, 400);
  }

  const [existingWorkspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.userUuid, user.uuid), eq(workspaces.giteaRepoName, repoSlug)))
    .limit(1);
  if (existingWorkspace) {
    return c.json({ message: "workspace slug already exists" }, 409);
  }

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const repo = await createRepository(gitAccount.giteaAccessToken, repoSlug, body?.private ?? true).catch((error) => error as Error);
  if (repo instanceof Error) {
    return c.json({ message: repo.message }, 500);
  }
  if ("alreadyExists" in repo && repo.alreadyExists) {
    return c.json({ message: "workspace slug already exists" }, 409);
  }

  const [workspace] = await db
    .insert(workspaces)
    .values({
      userUuid: user.uuid,
      name,
      description: body?.description?.trim() || null,
      giteaRepoName: repoSlug,
      visibility: body?.private === false ? "public" : "private",
    })
    .returning();
  if (!workspace) {
    return c.json({ message: "failed to create workspace" }, 500);
  }

  const detail = await buildWorkspaceDetail(workspace, { currentUserUuid: user.uuid });
  if (!detail) {
    return c.json({ message: "workspace not found" }, 404);
  }
  return c.json(detail);
});

app.get("/api/workspaces/public", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "20") || 20));
  const search = c.req.query("search")?.trim();
  const conditions = [eq(workspaces.visibility, "public")];

  if (search) {
    conditions.push(sql`${workspaces.name} ILIKE ${`%${search}%`}`);
  }

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaces)
    .where(and(...conditions));
  const total = countRows[0]?.count ?? 0;

  const items = await db
    .select()
    .from(workspaces)
    .where(and(...conditions))
    .orderBy(desc(workspaces.forkCount), desc(workspaces.updatedAt), desc(workspaces.createdAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return c.json({
    items: items.map(buildWorkspaceListItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

app.get("/api/workspaces/:id", async (c) => {
  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const token = c.get("token");
  const user = token ? await fetchAuthUser(token).catch(() => null) : null;

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return c.json({ message: "workspace not found" }, 404);
  if (workspace.visibility !== "public" && workspace.userUuid !== user?.uuid) {
    return c.json({ message: "workspace not found" }, 404);
  }

  const detail = await buildWorkspaceDetail(workspace, { currentUserUuid: user?.uuid });
  if (!detail) return c.json({ message: "workspace not found" }, 404);
  return c.json(detail);
});

app.patch("/api/workspaces/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace || workspace.userUuid !== user.uuid) return c.json({ message: "workspace not found" }, 404);

  const body = await c.req
    .json<{
      name?: string;
      description?: string;
      visibility?: "public" | "private";
    }>()
    .catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);

  const updates: Partial<typeof workspaces.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (body.visibility === "public" || body.visibility === "private") updates.visibility = body.visibility;

  if (updates.visibility && updates.visibility !== workspace.visibility) {
    const [gitAccount] = await db
      .select()
      .from(userGitAccounts)
      .where(eq(userGitAccounts.userUuid, workspace.userUuid))
      .limit(1);
    if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);
    await updateRepositoryVisibility(gitAccount.giteaUsername, workspace.giteaRepoName, updates.visibility === "private");
  }

  const [updated] = await db
    .update(workspaces)
    .set(updates)
    .where(eq(workspaces.id, workspaceId))
    .returning();
  if (!updated) return c.json({ message: "workspace not found" }, 404);

  const detail = await buildWorkspaceDetail(updated, { currentUserUuid: user.uuid });
  if (!detail) return c.json({ message: "workspace not found" }, 404);
  return c.json(detail);
});

app.delete("/api/workspaces/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace || workspace.userUuid !== user.uuid) return c.json({ message: "workspace not found" }, 404);

  const [gitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, workspace.userUuid))
    .limit(1);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);

  await deleteRepository(gitAccount.giteaUsername, workspace.giteaRepoName);
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  return c.body(null, 204);
});

app.post("/api/workspaces/:id/fork", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return c.json({ message: "workspace not found" }, 404);
  if (workspace.visibility !== "public") return c.json({ message: "workspace not found" }, 404);
  if (workspace.userUuid === user.uuid) return c.json({ message: "cannot fork your own workspace" }, 400);

  const [sourceGitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, workspace.userUuid))
    .limit(1);
  if (!sourceGitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);

  const targetGitAccount = await ensureUserGitAccount(user.uuid);
  const body = (await c.req.json<{ name?: string }>().catch(() => ({}))) as { name?: string };
  const requestedName = body.name?.trim();
  const targetRepoName = requestedName ? normalizeWorkspaceSlug(requestedName) : workspace.giteaRepoName;
  if (!targetRepoName) {
    return c.json({ message: "workspace name must contain letters or numbers" }, 400);
  }

  const [existingWorkspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.userUuid, user.uuid), eq(workspaces.giteaRepoName, targetRepoName)))
    .limit(1);
  if (existingWorkspace) {
    return c.json({ message: "workspace slug already exists" }, 409);
  }

  const forkedRepo = await forkRepository(
    sourceGitAccount.giteaUsername,
    workspace.giteaRepoName,
    targetGitAccount.giteaAccessToken,
    targetRepoName,
  );

  const [forkedWorkspace] = await db
    .insert(workspaces)
    .values({
      userUuid: user.uuid,
      name: requestedName || workspace.name,
      description: workspace.description,
      giteaRepoName: forkedRepo.name,
      visibility: workspace.visibility,
      parentId: workspace.id,
    })
    .returning();
  if (!forkedWorkspace) {
    return c.json({ message: "failed to create forked workspace" }, 500);
  }

  await db
    .update(workspaces)
    .set({
      forkCount: sql`${workspaces.forkCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, workspace.id));

  const detail = await buildWorkspaceDetail(forkedWorkspace, { currentUserUuid: user.uuid });
  if (!detail) return c.json({ message: "workspace not found" }, 404);
  return c.json(detail);
});

app.get("/api/workspaces/:id/tree", async (c) => {
  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const token = c.get("token");
  const user = token ? await fetchAuthUser(token).catch(() => null) : null;

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return c.json({ message: "workspace not found" }, 404);
  if (workspace.visibility !== "public" && workspace.userUuid !== user?.uuid) {
    return c.json({ message: "workspace not found" }, 404);
  }

  const [gitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, workspace.userUuid))
    .limit(1);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);

  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  const entries = await getDirectoryEntries(gitAccount.giteaUsername, workspace.giteaRepoName, path, ref);
  if (entries === null) return c.json({ message: "path not found" }, 404);
  return c.json({
    repoOwner: gitAccount.giteaUsername,
    repoName: workspace.giteaRepoName,
    path,
    ref: ref ?? null,
    entries,
  });
});

app.get("/api/workspaces/:id/file", async (c) => {
  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const token = c.get("token");
  const user = token ? await fetchAuthUser(token).catch(() => null) : null;

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return c.json({ message: "workspace not found" }, 404);
  if (workspace.visibility !== "public" && workspace.userUuid !== user?.uuid) {
    return c.json({ message: "workspace not found" }, 404);
  }

  const [gitAccount] = await db
    .select()
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, workspace.userUuid))
    .limit(1);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);

  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  if (!path.trim()) return c.json({ message: "path is required" }, 400);
  const file = await getFileContent(gitAccount.giteaUsername, workspace.giteaRepoName, path, ref);
  if (!file) return c.json({ message: "file not found" }, 404);
  return c.json(file);
});

app.post("/api/runtimes", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const body = (await c.req
    .json<{
      workspaceId?: string;
      agentId?: string;
      title?: string;
      cwd?: string;
      protocol?: "pi" | "acp" | "internal";
      meta?: Record<string, unknown>;
      start?: boolean;
      extraEnv?: Array<{ name: string; value: string }>;
      channelBindings?: Array<{ channelId: string; config?: Record<string, unknown> | null }>;
    }>()
    .catch(() => ({}))) as {
    workspaceId?: string;
    agentId?: string;
    title?: string;
    cwd?: string;
    protocol?: "pi" | "acp" | "internal";
    meta?: Record<string, unknown>;
    start?: boolean;
    extraEnv?: Array<{ name: string; value: string }>;
    channelBindings?: Array<{ channelId: string; config?: Record<string, unknown> | null }>;
  };

  if (body.workspaceId && !requireValidId(body.workspaceId)) {
    return c.json({ message: "workspace not found" }, 404);
  }
  if (body.agentId && !requireValidId(body.agentId)) {
    return c.json({ message: "agent not found" }, 404);
  }

  const normalizedExtraEnv = normalizeRuntimeEnv(body.extraEnv);
  validateRuntimeEnv(normalizedExtraEnv);

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
    if (channels.length !== ids.length) {
      return c.json({ message: "one or more channels are invalid" }, 400);
    }
  }

  const occupiedChannels = normalizedChannelBindings.length
    ? await db
        .select({ channelId: runtimeChannels.channelId })
        .from(runtimeChannels)
        .where(inArray(runtimeChannels.channelId, normalizedChannelBindings.map((binding) => binding.channelId)))
    : [];
  if (occupiedChannels.length > 0) {
    return c.json(
      {
        message: "channel binding already exists for this channel. Choose a different channel or reuse the existing runtime.",
      },
      409,
    );
  }

  const runtime = (await createRuntime({
    userUuid: user.uuid,
    workspaceId: body.workspaceId ?? null,
    agentId: body.agentId ?? null,
    title: body.title ?? null,
    cwd: body.cwd ?? null,
    protocol: body.protocol ?? "pi",
    meta: {
      ...(body.meta ?? {}),
      extraEnv: normalizedExtraEnv,
    },
  })).runtime;

  if (normalizedChannelBindings.length > 0) {
    await db.insert(runtimeChannels).values(
      normalizedChannelBindings.map((binding) => ({
        runtimeId: runtime.id,
        channelId: binding.channelId,
        config: binding.config,
      })),
    );
  }

  const session = await createInitialRuntimeSession({
    runtimeId: runtime.id,
    sessionId: crypto.randomUUID(),
    title: body.title ?? null,
    protocol: body.protocol ?? "pi",
    cwd: body.cwd ?? null,
    externalSessionId: null,
    meta: {
      source: "web",
      createdBy: "api_runtime_create",
      channelBindings: normalizedChannelBindings.length,
    },
  });

  const userUuid = user.uuid;

  if (body.start !== false) {
    void (async () => {
      await writeInitialRuntimeProvision(runtime.id);
      await provisionRuntimeInBackground({ runtimeId: runtime.id, userUuid });
    })().catch((error) => {
      console.error("[RuntimeProvision] background task failed:", {
        runtimeId: runtime.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return c.json({ runtime, session, ready: false });
});

app.get("/api/runtimes/:id/provisioning", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) {
    return c.json({ message: "runtime not found" }, 404);
  }

  const provisioning = await getRuntimeProvision(runtime.id);
  return c.json(provisioning);
});

app.get("/api/runtimes", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeList = await db
    .select()
    .from(runtimes)
    .where(eq(runtimes.userUuid, user.uuid))
    .orderBy(runtimes.updatedAt, runtimes.createdAt);

  return c.json(runtimeList);
});

app.get("/api/runtimes/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);
  return c.json({
    ...runtime,
    liveStatus: runtime.status ?? null,
  });
});

app.get("/api/runtimes/:id/sessions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);
  const sessions = await listRuntimeSessions(runtime.id);
  const bindings = await getBindingsByRuntimeId(runtime.id);

  const bindingsBySessionId = new Map<string, typeof bindings>();
  for (const binding of bindings) {
    const existing = bindingsBySessionId.get(binding.runtimeSessionId) ?? [];
    existing.push(binding);
    bindingsBySessionId.set(binding.runtimeSessionId, existing);
  }

  return c.json({
    runtime,
    sessions: sessions.map((session) => ({
      ...session,
      bindings: bindingsBySessionId.get(session.id) ?? [],
    })),
  });
});

app.get("/api/runtimes/:id/session-graph", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);
  const sessions = await getRuntimeSessionGraph(runtime.id);
  return c.json({ runtime, sessions });
});

app.post("/internal/runtimes/:id/sessions", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<RegisterRuntimeSessionInput>().catch(() => null);
  if (!body?.sessionId) return c.json({ message: "sessionId is required" }, 400);

  const existing = await getRuntimeSessionById(body.sessionId);
  if (existing) {
    const bootstrap = await getRuntimeSessionBootstrap(existing.id);
    return c.json({ ok: true, session: existing, bootstrap });
  }

  const session = await registerRuntimeSession({
    runtimeId,
    sessionId: body.sessionId,
    title: body.title,
    protocol: body.protocol,
    externalSessionId: body.externalSessionId,
    cwd: body.cwd,
    meta: body.meta,
  });

  const bootstrap = await getRuntimeSessionBootstrap(session.id);
  return c.json({ ok: true, session, bootstrap });
});

app.post("/internal/runtimes/:runtimeId/sessions/:sessionId/info", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("runtimeId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(runtimeId) || !requireValidId(sessionId)) {
    return c.json({ message: "session not found" }, 404);
  }

  const session = await getRuntimeSessionById(sessionId);
  if (!session || session.runtimeId !== runtimeId) {
    return c.json({ message: "session not found" }, 404);
  }

  const body = await c.req.json<PersistSessionInfoUpdateInput>().catch(() => null);
  if (!body) return c.json({ message: "invalid body" }, 400);

  await updateRuntimeSessionInfo({
    runtimeId,
    sessionId,
    title: body.title,
    updatedAt: body.updatedAt,
    meta: body.meta,
  });

  return c.json({ ok: true });
});

app.post("/internal/runtimes/:runtimeId/sessions/:sessionId/messages", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("runtimeId");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(runtimeId) || !requireValidId(sessionId)) {
    return c.json({ message: "session not found" }, 404);
  }

  const session = await getRuntimeSessionById(sessionId);
  if (!session || session.runtimeId !== runtimeId) {
    return c.json({ message: "session not found" }, 404);
  }

  const body = await c.req
    .json<{
      previousMessageId?: string | null;
      idempotencyKey?: string;
      message?: PersistMessageInput["message"];
      toolCalls?: PersistMessageInput["toolCalls"];
    }>()
    .catch(() => null);

  if (!body?.idempotencyKey?.trim()) return c.json({ message: "idempotencyKey is required" }, 400);
  if (!body.message || !Array.isArray(body.message.content)) {
    return c.json({ message: "message.content is required" }, 400);
  }

  const messageNode = await persistMessageNode({
    runtimeId,
    sessionId,
    previousMessageId: body.previousMessageId ?? null,
    idempotencyKey: body.idempotencyKey,
    message: {
      ...(body.message as PersistMessageInput["message"]),
      content: body.message.content as never,
    },
    toolCalls: body.toolCalls ?? undefined,
  });

  return c.json({ ok: true, message: messageNode });
});

app.get("/api/sessions/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "session not found" }, 404);
  return c.json({ runtime, session });
});

app.get("/api/sessions/:id/messages", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "session not found" }, 404);
  const messages = await listSessionMessages(session.id);
  const toolCalls = await listToolCallsByMessageIds(messages.map((message) => message.id));
  return c.json({ runtime, session, messages, toolCalls });
});

app.post("/api/sessions/:id/messages", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "session not found" }, 404);

  const body = await c.req.json<{
    text: string;
    images?: Array<{ url: string }>;
  }>();

  if (!body.text?.trim()) return c.json({ message: "text is required" }, 400);

  const userMessage = await createUserMessageNode({
    runtimeSessionId: session.id,
    text: body.text,
    images: body.images,
  });

  await enqueueRuntimePrompt({
    runtimeId: runtime.id,
    sessionId: session.id,
    userMessageId: userMessage.id,
    message: { text: body.text, images: body.images },
    meta: { intent: "continue", source: "web" },
  });

  return c.json({ ok: true, userMessage });
});

app.post("/api/sessions/:id/fork", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "session not found" }, 404);

  const body = await c.req.json<{ fromMessageId?: string; title?: string | null }>().catch(() => null);
  if (!body?.fromMessageId || !requireValidId(body.fromMessageId)) {
    return c.json({ message: "fromMessageId is required" }, 400);
  }

  const forked = await forkRuntimeSession({
    runtimeId: runtime.id,
    parentSessionId: session.id,
    fromMessageId: body.fromMessageId,
    title: body.title ?? null,
  });

  return c.json({ ok: true, session: forked });
});

app.post("/internal/runtimes/:id/sessions/:sessionId/provider-render", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("id");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(runtimeId) || !requireValidId(sessionId)) {
    return c.json({ message: "runtime session not found" }, 404);
  }

  const body = await c.req.json<{
    renderMode?: string | null;
    displayMode?: string | null;
    thinking?: string | null;
    toolCalls?: Array<Record<string, unknown>> | null;
    answer?: string | null;
  }>().catch(() => null);

  if (!body) return c.json({ message: "invalid body" }, 400);

  await updateProviderRenderForSession({
    runtimeId,
    runtimeSessionId: sessionId,
    render: body,
  });

  return c.json({ ok: true });
});

app.get("/api/runtimes/:id/stream", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);
  const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? undefined;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "ready", data: JSON.stringify({ runtimeId: runtime.id }) });
    const output = await readRuntimeOutputStream({ runtimeId: runtime.id, lastEventId, signal: c.req.raw.signal });
    for await (const entry of output) {
      if (c.req.raw.signal.aborted) break;
      await stream.writeSSE({ id: entry.id, event: "message", data: entry.payload ?? "" });
    }
  });
});


app.onError((error, c) => c.json({ message: error.message || "internal server error" }, 500));

const port = Number(process.env.PORT ?? 8787);
assertRequiredConfig();
serve({ fetch: app.fetch, port });
console.log(`@cohub/api listening on :${port}`);
