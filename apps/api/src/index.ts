import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { streamSSE } from "hono/streaming";
import { cors } from "hono/cors";
import { Hono, type Context } from "hono";

import {
  fetchAuthUser,
  getTokenFromRequest,
  type AuthUserProfile,
} from "./auth.js";
import {
  createRuntimeDirectory,
  deleteRuntimeNode,
  listRuntimeDirectory,
  moveRuntimeNode,
  readRuntimeFile,
  runtimeFsJsonError,
  streamRuntimeFile,
  writeRuntimeFile,
} from "./runtime-fs.js";
import { assertRequiredConfig, config } from "./config.js";
import {
  getDirectoryEntries,
  getFileContent,
  getRepository,
  createRepository,
  addSshKey,
  deleteSshKey,
  createAnonymousRepository,
  addDeployKeyToRepo,
  forkRepository,
  updateRepositoryVisibility,
  deleteRepository,
} from "./gitea.js";
import { ensureUserGitAccount } from "./git-accounts.js";
import type {
  PersistMessageInput,
  UpdateSessionInfoInput,
  RegisterSessionInput,
  ContentBlock,
} from "@cohub/protocol";
import {
  createRuntime,
  createInitialRuntimeSession,
  deleteRuntime,
  forkRuntimeSession,
  getRuntimeById,
  getRuntimeSessionBootstrap,
  getRuntimeSessionById,
  hibernateRuntime,
  listRuntimeSessions,
  listSessionMessages,
  normalizeRuntimeEnv,
  persistMessageNode,
  provisionRuntimeInBackground,
  readRuntimeOutputStream,
  registerRuntimeSession,
  updateRuntimeSessionInfo,
  validateRuntimeEnv,
  wakeRuntime,
  enqueueRuntimePrompt,
  updateRuntimeStatus,
} from "./runtime-sessions.js";
import { resolveSessionInteractionForInboundEvent } from "./session-interactions.js";
import { db } from "./db/index.js";
import { userChannels, userGitAccounts, workspaces, runtimeChannels, runtimes, resourcePermissions, cronJobs, taskRuns } from "./db/schema.js";
import { eq, and, inArray, isNull, desc, asc, sql, ne } from "drizzle-orm";
import { handleInboundEvent, syncRuntimeChannelConfigCache, getRuntimeChannelsByRuntimeId, getRuntimeChannelById, updateRuntimeChannelConfig } from "./channels.js";
import { initLogConsumerGroup, startGatewayLogConsumer, stopLogConsumer } from "./gateway-logs.js";
import { createBlockingRedisClient, redisCommandClient, ensureConsumerGroup, isRedisReady, GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP } from "./redis.js";
import type { GatewayInboundEvent, ResourcePermissionLevel, TaskScheduleConfig } from "@cohub/protocol";
import { normalizeWorkspaceSlug } from "@cohub/protocol";
import { canRead, canReadForSession, canWrite } from "./permissions.js";
import {
  createCronJob,
  removeCronJob,
  enableCronJob,
  taskQueue,
} from "./tasks.js";

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

// ─── Models catalog cache ───

const MODELS_CATALOG_URL = "https://gitea.cohub.run/global/configs/raw/branch/main/.pi/agent/models.json";
const MODELS_REDIS_KEY = "configs:models";
const MODELS_CACHE_TTL_SEC = 30 * 60; // 30 minutes

export type ModelCatalogEntry = {
  provider: string;
  id: string;
  model: Record<string, unknown>;
};

let modelsCachePromise: Promise<ModelCatalogEntry[]> | null = null;

async function fetchModelsCatalog(): Promise<ModelCatalogEntry[]> {
  if (modelsCachePromise) return modelsCachePromise;

  modelsCachePromise = (async () => {
    // Try Redis cache first
    const cached = await redisCommandClient.get(MODELS_REDIS_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ModelCatalogEntry[];
      } catch {
        // Corrupted cache, fall through to fetch
      }
    }

    // Fetch from Gitea
    const response = await fetch(MODELS_CATALOG_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch models catalog: ${response.status} ${response.statusText}`);
    }
    const raw = await response.json() as {
      providers: Record<string, { models?: Array<Record<string, unknown>> }>;
    };

    // Flatten: provider + models array only
    const entries: ModelCatalogEntry[] = [];
    for (const [provider, config] of Object.entries(raw.providers ?? {})) {
      for (const m of config.models ?? []) {
        entries.push({ provider, id: String(m.id), model: m });
      }
    }

    // Store flattened result in Redis
    await redisCommandClient.set(MODELS_REDIS_KEY, JSON.stringify(entries), "EX", MODELS_CACHE_TTL_SEC);

    return entries;
  })();

  try {
    return await modelsCachePromise;
  } finally {
    // Reset so next call can retry on failure
    modelsCachePromise = null;
  }
}

const CONSUMER_NAME = `api-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const INBOUND_BATCH_SIZE = 10;
const INBOUND_BLOCK_MS = 5000;

const initInboundConsumerGroup = async () => {
  await ensureConsumerGroup(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, "0");
  console.log("[Channels] Inbound consumer group ready:", INBOUND_CONSUMER_GROUP);
};

// Session response listener has been removed.
// Sessions now work via POST /sessions/:id/messages.

/**
 * 启动 Gateway Inbound 监听器（使用消费者组模式）
 * 支持多实例负载均衡和自动故障转移
 */
const startGatewayInboundListener = async () => {
  await initInboundConsumerGroup();

  const client = createBlockingRedisClient();
  console.log("[Channels] Inbound redis client status before connect:", client.status);
  if (client.status === "wait") {
    await client.connect();
  }
  console.log("[Channels] Inbound redis client status after connect:", client.status);

  console.log("[Channels] Inbound listener started", {
    group: INBOUND_CONSUMER_GROUP,
    consumer: CONSUMER_NAME,
  });

  while (true) {
    try {
      const result = await client.xreadgroup(
        "GROUP",
        INBOUND_CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT", INBOUND_BATCH_SIZE,
        "BLOCK", INBOUND_BLOCK_MS,
        "STREAMS", GATEWAY_INBOUND_STREAM, ">"
      );

      if (!result || result.length === 0) continue;

      for (const [, messages] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of messages) {
          const payload = fields[fields.indexOf("payload") + 1];
          if (!payload) {
            await redisCommandClient.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
            continue;
          }

          try {
            const event = JSON.parse(payload) as GatewayInboundEvent;
            console.log("[Channels] Consuming inbound event", {
              streamId: id,
              eventId: event.eventId,
              channelId: event.channelId,
              provider: event.provider,
              externalChatId: event.externalChatId,
              externalMessageId: event.externalMessageId,
              bindingKey: event.bindingKey,
            });
            await handleInboundEvent(event);
            await redisCommandClient.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
            console.log("[Channels] Acked inbound event", { streamId: id, eventId: event.eventId });
          } catch (err) {
            console.error(`[Channels] Failed to process ${id}:`, err);
            await redisCommandClient.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
          }
        }
      }
    } catch (e) {
      console.error("[Channels] Inbound error:", e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};

// Session response listener has been removed.
// Sessions now work via POST /sessions/:id/messages.

// 初始化并启动 Gateway 日志消费者（使用消费者组模式）
const initGatewayLogConsumer = async () => {
  try {
    await initLogConsumerGroup();
    await startGatewayLogConsumer();
  } catch (err) {
    console.error("[Init] Failed to start gateway log consumer:", err);
    throw err;
  }
};
initGatewayLogConsumer().catch(console.error);

// 启动 Gateway 入站事件监听
startGatewayInboundListener().catch(console.error);

// 优雅关闭处理
const shutdown = async (signal: string) => {
  console.log(`[Shutdown] Received ${signal}, stopping consumers...`);
  await stopLogConsumer();
  console.log("[Shutdown] Consumers stopped, exiting...");
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

type Variables = { token: string | null; authUser: AuthUserProfile | null };
const app = new Hono<{ Variables: Variables }>();

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const requireValidId = (id: string) => isUuid(id);
const ensureInternalRequest = (c: Context<{ Variables: Variables }>) => {
  // Priority: Worker Secret header (timing-safe comparison)
  const workerSecret = c.req.header("x-worker-secret");
  if (
    workerSecret &&
    config.workerSecret &&
    workerSecret.length === config.workerSecret.length &&
    timingSafeEqual(Buffer.from(workerSecret), Buffer.from(config.workerSecret))
  ) {
    return null;
  }

  // Fallback: IP allowlist (existing internal callers)
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
  const token = getTokenFromRequest(c);
  c.set("token", token);
  if (token) {
    c.set("authUser", await fetchAuthUser(token).catch(() => null));
  } else {
    c.set("authUser", null);
  }
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
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false,
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

app.get("/internal/metrics", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const { getStreamInfo, checkPendingMessages, GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, GATEWAY_LOGS_STREAM, LOG_CONSUMER_GROUP } = await import("./redis.js");

  const [inbound, logs, inboundPending, logsPending] = await Promise.all([
    getStreamInfo(GATEWAY_INBOUND_STREAM),
    getStreamInfo(GATEWAY_LOGS_STREAM),
    checkPendingMessages(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP),
    checkPendingMessages(GATEWAY_LOGS_STREAM, LOG_CONSUMER_GROUP),
  ]);

  return c.json({
    streams: {
      inbound: { ...inbound, pending: inboundPending.total },
      logs: { ...logs, pending: logsPending.total },
    },
  });
});

app.get("/api/me", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user) {
    return c.json({ message: "unauthorized" }, 401);
  }
  return c.json(user);
});

app.get("/v1/user/", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user) return c.json({ message: "unauthorized" }, 401);
  return c.json(user);
});

app.post("/api/v1/user/repos", async (c) => {
  const token = c.get("token");
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
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const body = await c.req.json<{ key: string; title: string }>();
  try {
    const key = await addSshKey(token, body.key, body.title);
    return c.json(key);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// ─── User SSH Key Management ──────────────────────────────

app.get("/api/user/ssh-keys", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const [account] = await db
    .select({ sshPublicKeys: userGitAccounts.sshPublicKeys })
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, user.uuid))
    .limit(1);

  return c.json(account?.sshPublicKeys ?? []);
});

app.post("/api/user/ssh-keys", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const body = await c.req.json<{ key: string; title: string }>().catch(() => null);
  if (!body?.key || !body?.title) {
    return c.json({ message: "key and title are required" }, 400);
  }

  if (!body.key.trim().startsWith("ssh-")) {
    return c.json({ message: "invalid SSH public key format" }, 400);
  }

  const gitAccount = await ensureUserGitAccount(user.uuid);
  const giteaKey = await addSshKey(gitAccount.giteaAccessToken, body.key.trim(), body.title.trim());

  if ("alreadyExists" in giteaKey) {
    return c.json({ message: "this SSH key already exists on Gitea" }, 409);
  }

  const entry = {
    id: crypto.randomUUID(),
    key: body.key.trim(),
    title: body.title.trim(),
    giteaKeyId: (giteaKey as { id: number }).id,
    createdAt: new Date().toISOString(),
  };

  const existingKeys = gitAccount.sshPublicKeys ?? [];
  const updatedKeys = [...existingKeys, entry];

  const accountId = gitAccount.id;
  if (!accountId) throw new Error("git account id is missing");

  await db
    .update(userGitAccounts)
    .set({ sshPublicKeys: updatedKeys, updatedAt: new Date() })
    .where(eq(userGitAccounts.id, accountId));

  return c.json(entry);
});

app.delete("/api/user/ssh-keys/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const sshKeyId = c.req.param("id");

  const [account] = await db
    .select({ sshPublicKeys: userGitAccounts.sshPublicKeys, id: userGitAccounts.id, giteaAccessTokenEncrypted: userGitAccounts.giteaAccessTokenEncrypted })
    .from(userGitAccounts)
    .where(eq(userGitAccounts.userUuid, user.uuid))
    .limit(1);

  if (!account) return c.json({ message: "git account not found" }, 404);

  const keys = account.sshPublicKeys ?? [];
  const targetEntry = keys.find((k) => k.id === sshKeyId);
  if (!targetEntry) return c.json({ message: "SSH key not found" }, 404);

  const { decryptSecret } = await import("./crypto.js");
  const gitAccessToken = decryptSecret(account.giteaAccessTokenEncrypted);

  await deleteSshKey(gitAccessToken, targetEntry.giteaKeyId).catch(() => {
    // Ignore Gitea delete errors — key may have been removed manually
  });

  const updatedKeys = keys.filter((k) => k.id !== sshKeyId);
  await db
    .update(userGitAccounts)
    .set({ sshPublicKeys: updatedKeys, updatedAt: new Date() })
    .where(eq(userGitAccounts.id, account.id));

  return c.json({ ok: true });
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
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const channels = await db.select().from(userChannels).where(eq(userChannels.userUuid, user.uuid));

  const channelIds = channels.map((ch) => ch.id);
  const runtimeBindings = channelIds.length > 0
    ? await db
        .select({
          channelId: runtimeChannels.channelId,
          runtimeId: runtimeChannels.runtimeId,
          runtimeTitle: runtimes.title,
          runtimeStatus: runtimes.status,
        })
        .from(runtimeChannels)
        .innerJoin(runtimes, eq(runtimeChannels.runtimeId, runtimes.id))
        .where(inArray(runtimeChannels.channelId, channelIds))
    : [];

  const bindingMap = new Map(runtimeBindings.map((b) => [b.channelId, b]));

  const channelsWithRuntime = channels.map((ch) => {
    const binding = bindingMap.get(ch.id);
    return {
      ...ch,
      boundRuntime: binding
        ? {
            id: binding.runtimeId,
            title: binding.runtimeTitle,
            status: binding.runtimeStatus,
          }
        : null,
    };
  });

  return c.json(channelsWithRuntime);
});

app.post("/api/channels", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
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
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const id = c.req.param("id");
  await db.delete(userChannels).where(and(eq(userChannels.id, id), eq(userChannels.userUuid, user.uuid)));
  return c.json({ ok: true });
});

app.get("/api/workspaces", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
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
  const user = c.get("authUser");
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
  const user = c.get("authUser");

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
  const user = c.get("authUser");
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
  const user = c.get("authUser");
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
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const workspaceId = c.req.param("id");
  if (!requireValidId(workspaceId)) return c.json({ message: "workspace not found" }, 404);

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return c.json({ message: "workspace not found" }, 404);
  // private workspace 只有 owner 能 fork；public workspace 任何人都能 fork
  if (workspace.visibility !== "public" && workspace.userUuid !== user.uuid) {
    return c.json({ message: "forbidden" }, 403);
  }

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
    return c.json({ message: "workspace with this name already exists" }, 409);
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
      visibility: "private",
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
  const user = c.get("authUser");

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
  const user = c.get("authUser");

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
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const body = (await c.req
    .json<{
      workspaceId?: string;
      agentId?: string;
      title?: string;
      source?: string;
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
    source?: string;
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
    start: body.start,
  })).runtime;

  if (normalizedChannelBindings.length > 0) {
    const insertedRuntimeChannels = await db.insert(runtimeChannels).values(
      normalizedChannelBindings.map((binding) => ({
        runtimeId: runtime.id,
        channelId: binding.channelId,
        config: binding.config,
      })),
    ).returning();

    await Promise.all(
      insertedRuntimeChannels.map((runtimeChannel) =>
        syncRuntimeChannelConfigCache({
          runtimeChannelId: runtimeChannel.id,
          config: (runtimeChannel.config as Record<string, unknown> | null) ?? null,
        }),
      ),
    );
  }

  const session = await createInitialRuntimeSession({
    runtimeId: runtime.id,
    sessionId: crypto.randomUUID(),
    title: null,
    source: body.source ?? null,
    protocol: body.protocol ?? "pi",
    cwd: body.cwd ?? null,
    externalSessionId: null,
    meta: {
      createdBy: "api_runtime_create",
      channelBindings: normalizedChannelBindings.length,
    },
  });

  const userUuid = user.uuid;

  if (body.start !== false) {
    void provisionRuntimeInBackground({ runtimeId: runtime.id, userUuid }).catch((error) => {
      console.error("[RuntimeProvision] background task failed:", {
        runtimeId: runtime.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return c.json({ runtime, session, ready: false });
});

// ─── Public models catalog (no auth required) ───

app.get("/api/models", async (c) => {
  try {
    const catalog = await fetchModelsCatalog();
    // Group by provider for frontend convenience
    const grouped: Record<string, ModelCatalogEntry[]> = {};
    for (const entry of catalog) {
      let list = grouped[entry.provider];
      if (!list) {
        list = [];
        grouped[entry.provider] = list;
      }
      list.push(entry);
    }
    return c.json(grouped);
  } catch (error) {
    return c.json(
      { message: error instanceof Error ? error.message : "Failed to fetch models catalog" },
      502,
    );
  }
});

app.get("/api/runtimes", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeList = await db
    .select()
    .from(runtimes)
    .where(and(eq(runtimes.userUuid, user.uuid), ne(runtimes.status, "deleted")))
    .orderBy(
      sql`CASE ${runtimes.status}
        WHEN 'starting' THEN 0
        WHEN 'running' THEN 1
        ELSE 2
      END`,
      asc(runtimes.status),
      desc(runtimes.createdAt),
    );

  const runtimeIds = runtimeList.map((r) => r.id);
  const channelBindings = runtimeIds.length > 0
    ? await db
        .select({
          runtimeId: runtimeChannels.runtimeId,
          channelId: runtimeChannels.channelId,
          channelName: userChannels.name,
          channelProvider: userChannels.provider,
          channelStatus: userChannels.status,
        })
        .from(runtimeChannels)
        .innerJoin(userChannels, eq(runtimeChannels.channelId, userChannels.id))
        .where(inArray(runtimeChannels.runtimeId, runtimeIds))
    : [];

  const bindingsByRuntime = new Map<string, typeof channelBindings>();
  for (const binding of channelBindings) {
    const list = bindingsByRuntime.get(binding.runtimeId) ?? [];
    list.push(binding);
    bindingsByRuntime.set(binding.runtimeId, list);
  }

  const runtimesWithChannels = runtimeList.map((rt) => {
    const bindings = bindingsByRuntime.get(rt.id) ?? [];
    return {
      ...rt,
      channels: bindings.map((b) => ({
        id: b.channelId,
        name: b.channelName,
        provider: b.channelProvider,
        status: b.channelStatus,
      })),
    };
  });

  return c.json(runtimesWithChannels);
});

app.get("/api/runtimes/:id/fs/tree", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const path = c.req.query("path") ?? "";
    const result = await listRuntimeDirectory(runtimeId, path);
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.get("/api/runtimes/:id/fs/file", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const path = c.req.query("path") ?? "";
    const result = await readRuntimeFile(runtimeId, path);
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.put("/api/runtimes/:id/fs/file", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const body = await c.req.json<{ path?: string; content?: string; encoding?: "utf-8" | "base64" }>().catch(() => null);
    if (!body?.path || typeof body.content !== "string" || !body.encoding) {
      return c.json({ code: "invalid_body", message: "path, content and encoding are required." }, 400);
    }
    const result = await writeRuntimeFile(runtimeId, {
      path: body.path,
      content: body.content,
      encoding: body.encoding,
    });
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.post("/api/runtimes/:id/fs/dir", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const body = await c.req.json<{ path?: string }>().catch(() => null);
    if (!body?.path) {
      return c.json({ code: "invalid_body", message: "path is required." }, 400);
    }
    const result = await createRuntimeDirectory(runtimeId, body.path);
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.delete("/api/runtimes/:id/fs/node", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const path = c.req.query("path") ?? "";
    const recursive = c.req.query("recursive") === "true";
    const result = await deleteRuntimeNode(runtimeId, path, recursive);
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.post("/api/runtimes/:id/fs/move", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const body = await c.req.json<{ fromPath?: string; toPath?: string }>().catch(() => null);
    if (!body?.fromPath || !body?.toPath) {
      return c.json({ code: "invalid_body", message: "fromPath and toPath are required." }, 400);
    }
    const result = await moveRuntimeNode(runtimeId, {
      fromPath: body.fromPath,
      toPath: body.toPath,
    });
    return c.json(result);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.get("/api/runtimes/:id/fs/download", async (c) => {
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  try {
    const path = c.req.query("path") ?? "";
    const info = await streamRuntimeFile(runtimeId, path);
    const buffer = await readFile(info.target);
    const fileName = encodeURIComponent(info.name).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    c.header("Content-Disposition", `attachment; filename="${info.name}"; filename*=UTF-8''${fileName}`);
    c.header("Content-Type", info.mimeType || "application/octet-stream");
    c.header("Content-Length", String(info.size));
    return c.body(buffer);
  } catch (error) {
    const { status, body } = runtimeFsJsonError(error);
    return c.json(body, status as 400 | 404 | 409 | 413 | 500 | 503);
  }
});

app.get("/api/runtimes/:id", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canRead(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);
  return c.json(runtime);
});

app.get("/api/runtimes/:id/channels", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const runtimeChannelRows = await getRuntimeChannelsByRuntimeId(runtime.id);
  const userChannelIds = runtimeChannelRows.map((item) => item.channelId);
  const channelRows = userChannelIds.length > 0
    ? await db
        .select()
        .from(userChannels)
        .where(and(eq(userChannels.userUuid, user.uuid), inArray(userChannels.id, userChannelIds)))
    : [];

  const userChannelById = new Map(channelRows.map((item) => [item.id, item]));

  return c.json(
    runtimeChannelRows.map((runtimeChannel) => ({
      ...runtimeChannel,
      channel: userChannelById.get(runtimeChannel.channelId) ?? null,
    })),
  );
});

app.post("/api/runtimes/:id/hibernate", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  try {
    const result = await hibernateRuntime({ runtimeId, userUuid: user.uuid });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Can only hibernate")) {
      return c.json({ message }, 400);
    }
    return c.json({ message: "failed to hibernate runtime" }, 500);
  }
});

app.post("/api/runtimes/:id/wake", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  try {
    const result = await wakeRuntime({ runtimeId, userUuid: user.uuid });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Can only wake") || message.includes("still terminating")) {
      return c.json({ message }, 409);
    }
    return c.json({ message: "failed to wake runtime" }, 500);
  }
});

app.delete("/api/runtimes/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  try {
    const result = await deleteRuntime({ runtimeId, userUuid: user.uuid });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Can only delete")) {
      return c.json({ message }, 400);
    }
    if (message.includes("Unauthorized")) {
      return c.json({ message: "runtime not found" }, 404);
    }
    return c.json({ message: "failed to delete runtime" }, 500);
  }
});

app.patch("/api/runtime-channels/:id/config", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeChannelId = c.req.param("id");
  if (!requireValidId(runtimeChannelId)) return c.json({ message: "runtime channel not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeChannel = await getRuntimeChannelById(runtimeChannelId);
  if (!runtimeChannel) return c.json({ message: "runtime channel not found" }, 404);

  const runtime = await getRuntimeById(runtimeChannel.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) {
    return c.json({ message: "runtime channel not found" }, 404);
  }

  const body = await c.req.json<{ config?: Record<string, unknown> | null }>().catch(() => null);
  if (!body || (body.config !== null && body.config !== undefined && (typeof body.config !== "object" || Array.isArray(body.config)))) {
    return c.json({ message: "config must be an object or null" }, 400);
  }

  const updated = await updateRuntimeChannelConfig({
    runtimeChannelId,
    config: body.config ?? null,
  });

  if (!updated) return c.json({ message: "runtime channel not found" }, 404);

  return c.json(updated);
});

app.post("/api/runtimes/:id/sessions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  if (!await canWrite(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ title?: string; source?: string; cwd?: string; protocol?: "pi" | "acp" | "internal" }>().catch(() => ({ title: undefined, source: undefined, cwd: undefined, protocol: undefined }));

  const session = await createInitialRuntimeSession({
    runtimeId: runtime.id,
    sessionId: crypto.randomUUID(),
    title: body.title ?? null,
    source: body.source ?? null,
    protocol: body.protocol ?? ((runtime.meta as Record<string, unknown>)?.protocol as "pi" | "acp" | "internal" | undefined) ?? "pi",
    cwd: body.cwd ?? ((runtime.meta as Record<string, unknown>)?.cwd as string | undefined) ?? null,
    externalSessionId: null,
    meta: { createdBy: "api_session_create" },
  });

  return c.json({ ok: true, session });
});

app.get("/api/runtimes/:id/sessions", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canRead(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);
  const sessions = await listRuntimeSessions(runtime.id);

  const permissions = await db
    .select()
    .from(resourcePermissions)
    .where(inArray(resourcePermissions.resourceId, [runtimeId, ...sessions.map((s) => s.id)]));
  const sessionShareLevels = new Map(
    permissions
      .filter((p) => p.resourceType === "session")
      .map((p) => [p.resourceId, p.level as ResourcePermissionLevel]),
  );

  const isOwner = user?.uuid === runtime.userUuid;
  const isCollaborator = !isOwner && permissions.some(
    (p) => p.resourceType === "runtime" && p.resourceId === runtimeId && p.granteeUuid === user?.uuid,
  );

  // Owner and collaborator(write) see all sessions; others only see publicly shared ones
  const visibleSessions = isOwner || isCollaborator
    ? sessions
    : sessions.filter((s) => canReadForSession(user, runtimeId, s.id));

  return c.json({
    runtime,
    sessions: visibleSessions.map((session) => ({
      ...session,
      shareLevel: sessionShareLevels.get(session.id) ?? null,
    })),
  });
});

app.post("/internal/runtimes/:id/status", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ status?: string }>().catch(() => null);
  if (!body?.status) return c.json({ message: "status is required" }, 400);

  await updateRuntimeStatus(runtimeId, body.status);
  return c.json({ ok: true });
});

app.post("/internal/runtimes/:id/sessions", async (c) => {
  const forbidden = ensureInternalRequest(c);
  if (forbidden) return forbidden;

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<RegisterSessionInput>().catch(() => null);
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

  const body = await c.req.json<UpdateSessionInfoInput>().catch(() => null);
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
      anchorUserMessageId?: string | null;
      idempotencyKey?: string;
      message?: PersistMessageInput["message"] & { id?: string | null };
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
    anchorUserMessageId: body.anchorUserMessageId ?? null,
    idempotencyKey: body.idempotencyKey,
    message: {
      ...(body.message as PersistMessageInput["message"]),
      id: body.message.id ?? undefined,
      content: body.message.content as never,
    } as PersistMessageInput["message"] & { id?: string },
  });

  return c.json({ ok: true, message: messageNode });
});

app.get("/api/sessions/:id", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  if (!await canRead(user, session.runtimeId, sessionId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(session.runtimeId);
  return c.json({ runtime, session });
});

app.get("/api/sessions/:id/messages", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  if (!await canRead(user, session.runtimeId, sessionId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(session.runtimeId);

  const cursorParam = c.req.query("cursor");
  const cursor = cursorParam ? Number(cursorParam) : undefined;
  const pageLimit = Math.min(Number(c.req.query("limit") ?? 30), 100) || 30;
  const direction = (c.req.query("direction") as "older" | "newer" | undefined) ?? "older";
  const fetchLimit = Math.min(pageLimit + 1, 101);

  const rows = await listSessionMessages(session.id, {
    cursor: cursor ? Number(cursor) : undefined,
    limit: fetchLimit,
    direction,
  });
  const hasMore = rows.length > pageLimit;
  const messages = hasMore ? rows.slice(0, pageLimit) : rows;

  return c.json({
    runtime,
    session,
    messages,
    hasMore,
    nextCursor: messages.length > 0
      ? direction === "older"
        ? (messages[0]?.sequence ?? 0) - 1
        : (messages[messages.length - 1]?.sequence ?? 0)
      : undefined,
  });
});

app.post("/api/sessions/:id/messages", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  if (!await canWrite(user, session.runtimeId, sessionId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{
    content: ContentBlock[];
    model?: string;
    provider?: string;
  }>();

  if (!body.content || body.content.length === 0) {
    return c.json({ message: "content is required" }, 400);
  }

  // Generate UUID — actual persistence happens on agent's message_end event
  // to guarantee correct sequence ordering
  const userMessageId = crypto.randomUUID();

  await enqueueRuntimePrompt({
    runtimeId: runtime.id,
    sessionId: session.id,
    userMessageId,
    content: body.content,
    meta: {
      intent: "continue",
      source: "web",
      model: body.model ?? null,
      provider: body.provider ?? null,
    },
  });

  return c.json({ ok: true, userMessageId });
});

app.post("/api/sessions/:id/fork", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  if (!await canRead(user, session.runtimeId, sessionId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

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

app.get("/api/sessions/:sessionId/stream", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const sessionId = c.req.param("sessionId");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);

  if (!await canRead(user, session.runtimeId, sessionId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);

  const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? undefined;

  return streamSSE(c, async (stream) => {
    const heartbeatMs = 25000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (c.req.raw.signal.aborted || stream.aborted || stream.closed) return;
      void stream.write(`: ping ${Date.now()}\n\n`).catch(() => undefined);
    }, heartbeatMs);

    stream.onAbort(() => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });

    try {
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ sessionId: session.id, runtimeId: runtime.id }) });
      const output = await readRuntimeOutputStream({ runtimeId: runtime.id, lastEventId, signal: c.req.raw.signal });
      for await (const entry of output) {
        if (c.req.raw.signal.aborted || stream.aborted || stream.closed) break;
        // Server-side filter: only forward events for this session
        const payload = entry.payload;
        if (payload) {
          try {
            const parsed = JSON.parse(payload) as { sessionId?: string };
            if (parsed.sessionId !== sessionId) continue;
          } catch {
            // Skip non-JSON payloads
            continue;
          }
        }
        await stream.writeSSE({ id: entry.id, event: "message", data: payload ?? "" });
      }
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  });
});

app.get("/api/runtimes/:id/stream", async (c) => {
  const token = c.get("token");
  const user = c.get("authUser");
  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);

  if (!await canRead(user, runtimeId)) {
    return c.json({ message: "not found" }, 404);
  }

  const runtime = await getRuntimeById(runtimeId);
  if (!runtime) return c.json({ message: "runtime not found" }, 404);
  const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? undefined;

  return streamSSE(c, async (stream) => {
    const heartbeatMs = 25000;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (c.req.raw.signal.aborted || stream.aborted || stream.closed) return;
      void stream.write(`: ping ${Date.now()}\n\n`).catch(() => undefined);
    }, heartbeatMs);

    stream.onAbort(() => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });

    try {
      await stream.writeSSE({ event: "ready", data: JSON.stringify({ runtimeId: runtime.id }) });
      const output = await readRuntimeOutputStream({ runtimeId: runtime.id, lastEventId, signal: c.req.raw.signal });
      for await (const entry of output) {
        if (c.req.raw.signal.aborted || stream.aborted || stream.closed) break;
        await stream.writeSSE({ id: entry.id, event: "message", data: entry.payload ?? "" });
      }
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  });
});


// ─── Permission management ───

/**
 * POST /api/runtimes/:id/permissions
 * 设置 runtime 公共资源级别（granteeUuid = NULL）。
 * 用于前端 "public read" 开关。
 */
app.post("/api/runtimes/:id/permissions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body || (body.level !== "read" && body.level !== "write" && body.level !== "private")) {
    return c.json({ message: "level must be 'read', 'write', or 'private'" }, 400);
  }

  const [perm] = await db
    .insert(resourcePermissions)
    .values({
      resourceType: "runtime",
      resourceId: runtimeId,
      granteeUuid: null,
      level: body.level,
      createdBy: user.uuid,
    })
    .onConflictDoUpdate({
      target: [resourcePermissions.resourceType, resourcePermissions.resourceId, resourcePermissions.granteeUuid],
      set: { level: sql`EXCLUDED.level` },
    })
    .returning();

  return c.json(perm);
});

/**
 * POST /api/sessions/:id/permissions
 * 设置 session 公共资源级别（granteeUuid = NULL）。
 */
app.post("/api/sessions/:id/permissions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body || (body.level !== "read" && body.level !== "write" && body.level !== "private")) {
    return c.json({ message: "level must be 'read', 'write', or 'private'" }, 400);
  }

  const [perm] = await db
    .insert(resourcePermissions)
    .values({
      resourceType: "session",
      resourceId: sessionId,
      granteeUuid: null,
      level: body.level,
      createdBy: user.uuid,
    })
    .onConflictDoUpdate({
      target: [resourcePermissions.resourceType, resourcePermissions.resourceId, resourcePermissions.granteeUuid],
      set: { level: sql`EXCLUDED.level` },
    })
    .returning();

  return c.json(perm);
});

/**
 * GET /api/runtimes/:id/permissions
 * 返回公共权限记录 + session 级权限记录。
 * （协作者列表请使用 GET /api/runtimes/:id/collaborators）
 */
app.get("/api/runtimes/:id/permissions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  // 同时查 runtime 级和该 runtime 下所有 session 级权限
  const sessions = await listRuntimeSessions(runtimeId);
  const resourceIds = [runtimeId, ...sessions.map(s => s.id)];

  const perms = await db
    .select()
    .from(resourcePermissions)
    .where(inArray(resourcePermissions.resourceId, resourceIds))
    .orderBy(resourcePermissions.createdAt);

  return c.json(perms);
});

/**
 * DELETE /api/runtimes/:id/permissions
 * 仅删除公共权限记录（granteeUuid = NULL）。
 */
app.delete("/api/runtimes/:id/permissions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "runtime"),
      eq(resourcePermissions.resourceId, runtimeId),
      isNull(resourcePermissions.granteeUuid),
    ));

  return c.json({ ok: true });
});

/**
 * DELETE /api/sessions/:id/permissions
 * 仅删除 session 公共权限记录。
 */
app.delete("/api/sessions/:id/permissions", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const sessionId = c.req.param("id");
  if (!requireValidId(sessionId)) return c.json({ message: "session not found" }, 404);
  const session = await getRuntimeSessionById(sessionId);
  if (!session) return c.json({ message: "session not found" }, 404);
  const runtime = await getRuntimeById(session.runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "session"),
      eq(resourcePermissions.resourceId, sessionId),
      isNull(resourcePermissions.granteeUuid),
    ));

  return c.json({ ok: true });
});


// ─── Collaborator management ───

/**
 * POST /api/runtimes/:id/collaborators
 * 添加协作者。仅 owner 可操作。
 */
app.post("/api/runtimes/:id/collaborators", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ granteeUuid: string; level: ResourcePermissionLevel }>().catch(() => null);
  if (!body?.granteeUuid || !body?.level) {
    return c.json({ message: "granteeUuid and level are required" }, 400);
  }
  if (!isUuid(body.granteeUuid)) {
    return c.json({ message: "granteeUuid must be a valid UUID" }, 400);
  }
  if (body.level !== "read" && body.level !== "write") {
    return c.json({ message: "level must be 'read' or 'write'" }, 400);
  }
  if (body.granteeUuid === user.uuid) {
    return c.json({ message: "cannot add yourself as collaborator" }, 400);
  }

  try {
    const [perm] = await db
      .insert(resourcePermissions)
      .values({
        resourceType: "runtime",
        resourceId: runtimeId,
        granteeUuid: body.granteeUuid,
        level: body.level,
        createdBy: user.uuid,
      })
      .onConflictDoUpdate({
        target: [resourcePermissions.resourceType, resourcePermissions.resourceId, resourcePermissions.granteeUuid],
        set: { level: sql`EXCLUDED.level` },
      })
      .returning();
    return c.json(perm);
  } catch {
    return c.json({ message: "failed to add collaborator" }, 500);
  }
});

/**
 * GET /api/runtimes/:id/collaborators
 * 查看协作者列表。仅 owner 可操作。
 */
app.get("/api/runtimes/:id/collaborators", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  if (!requireValidId(runtimeId)) return c.json({ message: "runtime not found" }, 404);
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const collaborators = await db
    .select()
    .from(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "runtime"),
      eq(resourcePermissions.resourceId, runtimeId),
    ))
    .orderBy(resourcePermissions.createdAt);

  // 只返回 granteeUuid != NULL 的记录
  return c.json(collaborators.filter((p) => p.granteeUuid !== null));
});

/**
 * PATCH /api/runtimes/:id/collaborators/:granteeUuid
 * 修改协作者权限级别。仅 owner 可操作。
 */
app.patch("/api/runtimes/:id/collaborators/:granteeUuid", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  const granteeUuid = c.req.param("granteeUuid");
  if (!requireValidId(runtimeId) || !granteeUuid) return c.json({ message: "runtime not found" }, 404);
  if (!isUuid(granteeUuid)) {
    return c.json({ message: "granteeUuid must be a valid UUID" }, 400);
  }
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const body = await c.req.json<{ level: ResourcePermissionLevel }>().catch(() => null);
  if (!body?.level || (body.level !== "read" && body.level !== "write")) {
    return c.json({ message: "level must be 'read' or 'write'" }, 400);
  }

  const [updated] = await db
    .update(resourcePermissions)
    .set({ level: body.level })
    .where(and(
      eq(resourcePermissions.resourceType, "runtime"),
      eq(resourcePermissions.resourceId, runtimeId),
      eq(resourcePermissions.granteeUuid, granteeUuid),
    ))
    .returning();

  if (!updated) return c.json({ message: "collaborator not found" }, 404);
  return c.json(updated);
});

/**
 * DELETE /api/runtimes/:id/collaborators/:granteeUuid
 * 移除协作者。仅 owner 可操作。
 */
app.delete("/api/runtimes/:id/collaborators/:granteeUuid", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = c.get("authUser");
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const runtimeId = c.req.param("id");
  const granteeUuid = c.req.param("granteeUuid");
  if (!requireValidId(runtimeId) || !granteeUuid) return c.json({ message: "runtime not found" }, 404);
  if (!isUuid(granteeUuid)) {
    return c.json({ message: "granteeUuid must be a valid UUID" }, 400);
  }
  const runtime = await getRuntimeById(runtimeId);
  if (!runtime || runtime.userUuid !== user.uuid) return c.json({ message: "runtime not found" }, 404);

  const [deleted] = await db
    .delete(resourcePermissions)
    .where(and(
      eq(resourcePermissions.resourceType, "runtime"),
      eq(resourcePermissions.resourceId, runtimeId),
      eq(resourcePermissions.granteeUuid, granteeUuid),
    ))
    .returning();

  if (!deleted) return c.json({ message: "collaborator not found" }, 404);
  return c.json({ ok: true });
});


// ─── Cron Job Management ───

app.post("/api/cron-jobs", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const body = await c.req.json<{
    title: string;
    taskType: string;
    payload: Record<string, unknown>;
    cronExpression: string;
    timezone?: string;
    workspaceId?: string;
    runtimeId?: string;
    sessionId?: string;
  }>().catch(() => null);

  if (!body?.title?.trim()) return c.json({ message: "title is required" }, 400);
  if (!body?.taskType) return c.json({ message: "taskType is required" }, 400);
  if (!body?.cronExpression) return c.json({ message: "cronExpression is required" }, 400);

  const schedule: TaskScheduleConfig = {
    pattern: body.cronExpression,
    timezone: body.timezone,
  };

  const cronJob = await createCronJob({
    userId: user.uuid,
    title: body.title.trim(),
    taskType: body.taskType,
    payload: body.payload ?? {},
    schedule,
    workspaceId: body.workspaceId ?? null,
    runtimeId: body.runtimeId ?? null,
    sessionId: body.sessionId ?? null,
  });

  return c.json(cronJob);
});

app.get("/api/cron-jobs", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const jobs = await db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.userUuid, user.uuid))
    .orderBy(desc(cronJobs.createdAt));

  return c.json({ jobs });
});

app.get("/api/cron-jobs/:id/runs", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  // Verify ownership
  const [job] = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), eq(cronJobs.userUuid, user.uuid)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);

  const runs = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.cronJobId, cronJobId))
    .orderBy(desc(taskRuns.createdAt))
    .limit(50);

  return c.json({ runs });
});

app.delete("/api/cron-jobs/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  const [job] = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), eq(cronJobs.userUuid, user.uuid)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);

  await removeCronJob(cronJobId, job.bullJobKey);
  return c.json({ ok: true });
});

app.patch("/api/cron-jobs/:id", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const cronJobId = c.req.param("id");
  if (!requireValidId(cronJobId)) return c.json({ message: "not found" }, 404);

  const [job] = await db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.id, cronJobId), eq(cronJobs.userUuid, user.uuid)))
    .limit(1);
  if (!job) return c.json({ message: "not found" }, 404);

  const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
  if (body?.enabled === undefined) return c.json({ message: "enabled is required" }, 400);

  if (body.enabled && !job.enabled) {
    await enableCronJob(cronJobId, job.bullJobKey, {
      taskType: job.taskType,
      payload: job.payload,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
      userUuid: job.userUuid,
      workspaceId: job.workspaceId,
      runtimeId: job.runtimeId,
      sessionId: job.sessionId,
    });
  } else if (!body.enabled && job.enabled) {
    await removeCronJob(cronJobId, job.bullJobKey);
  }

  return c.json({ ok: true });
});

// ─── Task Run History ───

app.get("/api/tasks/runs", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);

  const cronJobId = c.req.query("cronJobId");
  const runtimeId = c.req.query("runtimeId");
  const workspaceId = c.req.query("workspaceId");

  const conditions = [eq(taskRuns.userUuid, user.uuid)];
  if (cronJobId && requireValidId(cronJobId)) conditions.push(eq(taskRuns.cronJobId, cronJobId));
  if (runtimeId && requireValidId(runtimeId)) conditions.push(eq(taskRuns.runtimeId, runtimeId));
  if (workspaceId && requireValidId(workspaceId)) conditions.push(eq(taskRuns.workspaceId, workspaceId));

  const runs = await db
    .select()
    .from(taskRuns)
    .where(and(...conditions))
    .orderBy(desc(taskRuns.createdAt))
    .limit(50);

  return c.json({ runs });
});


app.onError((error, c) => {
  const path = c.req.path;
  const method = c.req.method;
  console.error(`[API Error] ${method} ${path}:`, {
    message: error.message,
    stack: error.stack,
    name: error.name,
  });
  return c.json({ message: error.message || "internal server error" }, 500);
});

const port = Number(process.env.PORT ?? 8787);
assertRequiredConfig();
const server = serve({
  fetch: app.fetch,
  port,
  serverOptions: {
    requestTimeout: 0,
    keepAliveTimeout: 75_000,
  },
});
server.setTimeout(0);
console.log(`@cohub/api listening on :${port}`);
