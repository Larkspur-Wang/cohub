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
} from "./gitea.js";
import { ensureUserGitAccount } from "./git-accounts.js";
import type {
  PersistMessageInput,
  PersistSessionInfoUpdateInput,
  RegisterRuntimeSessionInput,
  RuntimePromptInput,
} from "@cohub/protocol";
import {
  createRuntime,
  createUserMessageNode,
  enqueueRuntimePrompt,
  getCurrentPathMessages,
  getRuntimeById,
  getRuntimeSessionById,
  launchRuntimeSandbox,
  listRuntimeSessions,
  listSessionTree,
  listToolCallsByMessageIds,
  persistMessageNode,
  readRuntimeOutputStream,
  registerRuntimeSession,
  selectRuntimeSessionLeaf,
  updateRuntimeSessionInfo,
  waitForRuntimeRunning,
} from "./runtime-sessions.js";
import { db } from "./db/index.js";
import { userChannels, userGitAccounts, workspaces } from "./db/schema.js";
import { eq, and } from "drizzle-orm";
import { handleInboundEvent } from "./channels.js";
import { startGatewayLogConsumer } from "./gateway-logs.js";
import { redis as apiRedis } from "./redis.js";
import type { GatewayInboundEvent } from "@cohub/protocol";
import { normalizeWorkspaceSlug } from "@cohub/protocol";

// 启动 API 的后台监听器，处理来自网关的消息
const startGatewayInboundListener = async () => {
  let lastId = "$";
  console.log("[Channels] API Gateway Inbound Listener started.");
  while (true) {
    try {
      const result = await apiRedis.xread("BLOCK", 0, "STREAMS", "stream:gateway:inbound", lastId);
      if (!result) continue;
      for (const [stream, messages] of result) {
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
      await new Promise(resolve => setTimeout(resolve, 5000));
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
    return c.json({ sshUrl: repo.ssh_url, webUrl: repo.html_url });
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/api/workspaces", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const ws = await db.select().from(workspaces).where(eq(workspaces.userUuid, user.uuid));
  return c.json(ws.map((item) => ({ ...item, owner: user.uuid })));
});

app.get("/api/infrastructure/git-account", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const [account] = await db
    .select({ status: userGitAccounts.status, createdAt: userGitAccounts.createdAt })
    .from(userGitAccounts)
    .where(
      and(
        eq(userGitAccounts.userUuid, user.uuid),
        eq(userGitAccounts.provider, "gitea"),
      ),
    )
    .limit(1);
  return c.json({
    ready: Boolean(account),
    status: account?.status ?? "missing",
    createdAt: account?.createdAt ?? null,
  });
});

app.post("/api/workspaces", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const body = await c.req.json<{ name: string; description?: string; private?: boolean }>();
  const workspaceName = body.name?.trim();
  if (!workspaceName) return c.json({ message: "workspace name is required" }, 400);

  const workspaceSlug = normalizeWorkspaceSlug(workspaceName);
  if (!workspaceSlug) {
    return c.json({ message: "workspace name must contain letters or numbers" }, 400);
  }

  const [existingWorkspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.userUuid, user.uuid), eq(workspaces.giteaRepoName, workspaceSlug)))
    .limit(1);
  if (existingWorkspace) {
    return c.json({ message: "workspace slug already exists" }, 409);
  }

  const gitAccount = await ensureUserGitAccount(user.uuid);
  if (!gitAccount) return c.json({ message: "failed to prepare workspace infrastructure" }, 500);

  const repo = await createRepository(gitAccount.giteaAccessToken, workspaceSlug, body.private ?? true);
  if ("alreadyExists" in repo && repo.alreadyExists) {
    return c.json({ message: "workspace slug already exists" }, 409);
  }

  const [ws] = await db.insert(workspaces).values({
    userUuid: user.uuid,
    name: workspaceName,
    description: body.description?.trim() || null,
    giteaRepoName: repo.name,
    visibility: (body.private ?? true) ? "private" : "public",
  }).returning();
  return c.json({ ...ws, owner: user.uuid });
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

app.get("/api/workspaces/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  const data = await getRepository(owner, repo);
  if (!data) return c.json({ message: "workspace not found" }, 404);
  return c.json(data);
});

app.get("/api/workspaces/by-user/:userUuid/:repo", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const { userUuid, repo: repoParam } = c.req.param();
  if (!repoParam) return c.json({ message: "workspace not found" }, 404);
  const repo = repoParam;
  if (userUuid !== user.uuid) return c.json({ message: "forbidden" }, 403);
  const gitAccount = await ensureUserGitAccount(user.uuid);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);
  const data = await getRepository(gitAccount.giteaUsername, repo);
  if (!data) return c.json({ message: "workspace not found" }, 404);
  return c.json(data);
});

app.get("/api/workspaces/by-user/:userUuid/:repo/tree", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const { userUuid, repo: repoParam } = c.req.param();
  if (!repoParam) return c.json({ message: "workspace not found" }, 404);
  const repo = repoParam;
  if (userUuid !== user.uuid) return c.json({ message: "forbidden" }, 403);
  const gitAccount = await ensureUserGitAccount(user.uuid);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  const entries = await getDirectoryEntries(gitAccount.giteaUsername, repo, path, ref);
  if (entries === null) return c.json({ message: "path not found" }, 404);
  return c.json({ owner: gitAccount.giteaUsername, repo, path, ref: ref ?? null, entries });
});

app.get("/api/workspaces/by-user/:userUuid/:repo/file", async (c) => {
  const token = c.get("token");
  if (!token) return c.json({ message: "unauthorized" }, 401);
  const user = await fetchAuthUser(token);
  if (!user?.uuid) return c.json({ message: "unauthorized" }, 401);
  const { userUuid, repo: repoParam } = c.req.param();
  if (!repoParam) return c.json({ message: "workspace not found" }, 404);
  const repo = repoParam;
  if (userUuid !== user.uuid) return c.json({ message: "forbidden" }, 403);
  const gitAccount = await ensureUserGitAccount(user.uuid);
  if (!gitAccount?.giteaUsername) return c.json({ message: "workspace not found" }, 404);
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  if (!path.trim()) return c.json({ message: "path is required" }, 400);
  const file = await getFileContent(gitAccount.giteaUsername, repo, path, ref);
  if (!file) return c.json({ message: "file not found" }, 404);
  return c.json(file);
});

app.get("/api/workspaces/:owner/:repo/tree", async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  const entries = await getDirectoryEntries(owner, repo, path, ref);
  if (entries === null) return c.json({ message: "path not found" }, 404);
  return c.json({ owner, repo, path, ref: ref ?? null, entries });
});

app.get("/api/workspaces/:owner/:repo/file", async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");
  if (!path.trim()) return c.json({ message: "path is required" }, 400);
  const file = await getFileContent(owner, repo, path, ref);
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
    }>()
    .catch(() => ({}))) as {
    workspaceId?: string;
    agentId?: string;
    title?: string;
    cwd?: string;
    protocol?: "pi" | "acp" | "internal";
    meta?: Record<string, unknown>;
    start?: boolean;
  };

  const { runtime } = await createRuntime({
    userUuid: user.uuid,
    workspaceId: body.workspaceId ?? null,
    agentId: body.agentId ?? null,
    title: body.title ?? null,
    cwd: body.cwd ?? null,
    protocol: body.protocol ?? "pi",
    meta: body.meta ?? null,
  });

  if (body.start !== false) {
    await launchRuntimeSandbox({ runtimeId: runtime.id, userUuid: user.uuid });
    await waitForRuntimeRunning(runtime.id);
  }

  return c.json({ runtime, ready: true });
});

app.post("/api/runtimes/:id/prompt", async (c) => {
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

  const body = await c.req.json<{
    sessionId?: string;
    userMessageId?: string;
    text: string;
    images?: Array<{ url: string }>;
    branchFromMessageId?: string;
    meta?: RuntimePromptInput["meta"];
  }>();

  if (!body.text?.trim()) return c.json({ message: "text is required" }, 400);

  let sessionId = body.sessionId ?? null;
  if (sessionId) {
    const session = await getRuntimeSessionById(sessionId);
    if (!session || session.runtimeId !== runtime.id) {
      return c.json({ message: "session not found" }, 404);
    }
  } else {
    const createdSession = await registerRuntimeSession({
      runtimeId: runtime.id,
      sessionId: crypto.randomUUID(),
      title: null,
      protocol: "pi",
      cwd: null,
      externalSessionId: null,
      meta: { source: "web", createdBy: "api_prompt" },
    });
    sessionId = createdSession.id;
  }

  const userMessage = await createUserMessageNode({
    runtimeSessionId: sessionId,
    text: body.text,
    images: body.images,
    branchFromMessageId: body.branchFromMessageId ?? null,
  });

  await enqueueRuntimePrompt({
    runtimeId: runtime.id,
    sessionId,
    userMessageId: userMessage?.id ?? body.userMessageId ?? null,
    branchFromMessageId: body.branchFromMessageId ?? null,
    message: {
      text: body.text,
      images: body.images,
    },
    meta: body.meta ?? { intent: body.sessionId ? "continue" : "new_session", source: "web" },
  });

  return c.json({ ok: true, runtime, sessionId, userMessage });
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
  return c.json(runtime);
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
  if (existing) return c.json({ ok: true, session: existing });

  const session = await registerRuntimeSession({
    runtimeId,
    sessionId: body.sessionId,
    title: body.title,
    protocol: body.protocol,
    externalSessionId: body.externalSessionId,
    cwd: body.cwd,
    meta: body.meta,
  });

  return c.json({ ok: true, session });
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
      parentMessageId?: string;
      idempotencyKey?: string;
      message?: PersistMessageInput["message"];
      toolCalls?: PersistMessageInput["toolCalls"];
    }>()
    .catch(() => null);

  if (!body?.parentMessageId) return c.json({ message: "parentMessageId is required" }, 400);
  if (!body.idempotencyKey?.trim()) return c.json({ message: "idempotencyKey is required" }, 400);
  if (!body.message || !Array.isArray(body.message.content)) {
    return c.json({ message: "message.content is required" }, 400);
  }

  const messageNode = await persistMessageNode({
    runtimeId,
    sessionId,
    parentMessageId: body.parentMessageId,
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
  return c.json(session);
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
  const messages = await getCurrentPathMessages(session.id);
  const toolCalls = await listToolCallsByMessageIds(messages.map((message) => message.id));
  return c.json({ runtime, session, messages, toolCalls });
});

app.get("/api/sessions/:id/tree", async (c) => {
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
  const nodes = await listSessionTree(session.id);
  return c.json({
    runtime,
    session: {
      id: session.id,
      currentLeafMessageId: session.currentLeafMessageId,
      rootMessageId: session.rootMessageId,
      totalBranches: session.totalBranches,
    },
    nodes,
  });
});

app.post("/api/sessions/:id/select-leaf", async (c) => {
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
  const body = await c.req.json<{ leafMessageId?: string }>().catch(() => null);
  if (!body?.leafMessageId) return c.json({ message: "leafMessageId is required" }, 400);
  await selectRuntimeSessionLeaf({ runtimeSessionId: session.id, leafMessageId: body.leafMessageId });
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
    branchFromMessageId?: string;
  }>();

  if (!body.text?.trim()) return c.json({ message: "text is required" }, 400);

  const userMessage = await createUserMessageNode({
    runtimeSessionId: session.id,
    text: body.text,
    images: body.images,
    branchFromMessageId: body.branchFromMessageId ?? null,
  });

  await enqueueRuntimePrompt({
    runtimeId: runtime.id,
    sessionId: session.id,
    userMessageId: userMessage.id,
    branchFromMessageId: body.branchFromMessageId ?? null,
    message: { text: body.text, images: body.images },
    meta: { intent: "continue", source: "web" },
  });

  return c.json({ ok: true, userMessage });
});

app.post("/api/sessions/:id/abort", async (c) => {
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
  await enqueueRuntimePrompt({
    runtimeId: runtime.id,
    sessionId: session.id,
    userMessageId: null,
    branchFromMessageId: null,
    message: { text: "__abort__" },
    meta: { intent: "continue", source: "web" },
  });
  return c.json({ ok: true });
});

app.onError((error, c) => c.json({ message: error.message || "internal server error" }, 500));

const port = Number(process.env.PORT ?? 8787);
assertRequiredConfig();
serve({ fetch: app.fetch, port });
console.log(`@cohub/api listening on :${port}`);
