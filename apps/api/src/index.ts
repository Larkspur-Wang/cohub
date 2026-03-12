import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { clearTokenCookie, fetchAuthUser, getTokenFromRequest, setTokenCookie } from "./auth.js";
import { assertRequiredConfig, config } from "./config.js";
import { getDirectoryEntries, getFileContent, getRepository, createRepository, addSshKey } from "./gitea.js";

type Variables = {
  token: string | null;
};

const app = new Hono<{ Variables: Variables }>();

app.use("*", async (c, next) => {
  c.set("token", getTokenFromRequest(c));
  await next();
});

app.use(
  "*",
  cors({
    origin: config.webOrigin ?? "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-token", "Authorization"],
    credentials: true
  })
);

app.get("/healthz", (c) => c.json({ ok: true }));

app.post("/api/auth/token", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch(() => null);
  const token = body?.token?.trim();
  if (!token) {
    return c.json({ message: "token is required" }, 400);
  }

  const user = await fetchAuthUser(token).catch((error: unknown) => {
    return error;
  });

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
  if (!token) {
    return c.json({ message: "unauthorized" }, 401);
  }

  const user = await fetchAuthUser(token);
  if (!user) {
    clearTokenCookie(c);
    return c.json({ message: "unauthorized" }, 401);
  }

  return c.json(user);
});

app.get("/v1/user/", async (c) => {
  const token = c.req.header("x-token");
  if (!token) {
    return c.json({ message: "unauthorized" }, 401);
  }
  const user = await fetchAuthUser(token);
  if (!user) {
    return c.json({ message: "unauthorized" }, 401);
  }
  return c.json(user);
});

app.post("/api/v1/user/repos", async (c) => {
  const token = c.req.header("x-token");
  if (!token) {
    return c.json({ message: "unauthorized" }, 401);
  }
  const body = await c.req.json<{ name: string; private?: boolean }>();
  try {
    const repo = await createRepository(token, body.name, body.private ?? true);
    return c.json(repo);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.post("/api/v1/user/keys", async (c) => {
  const token = c.req.header("x-token");
  if (!token) {
    return c.json({ message: "unauthorized" }, 401);
  }
  const body = await c.req.json<{ key: string; title: string }>();
  try {
    const key = await addSshKey(token, body.key, body.title);
    return c.json(key);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

app.get("/api/workspaces/:owner/:repo", async (c) => {
  const { owner, repo } = c.req.param();
  const data = await getRepository(owner, repo);
  if (!data) {
    return c.json({ message: "workspace not found" }, 404);
  }
  return c.json(data);
});

app.get("/api/workspaces/:owner/:repo/tree", async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");

  const entries = await getDirectoryEntries(owner, repo, path, ref);
  if (entries === null) {
    return c.json({ message: "path not found" }, 404);
  }

  return c.json({
    owner,
    repo,
    path,
    ref: ref ?? null,
    entries
  });
});

app.get("/api/workspaces/:owner/:repo/file", async (c) => {
  const { owner, repo } = c.req.param();
  const path = c.req.query("path") ?? "";
  const ref = c.req.query("ref");

  if (!path.trim()) {
    return c.json({ message: "path is required" }, 400);
  }

  const file = await getFileContent(owner, repo, path, ref);
  if (!file) {
    return c.json({ message: "file not found" }, 404);
  }

  return c.json(file);
});

app.onError((error, c) => {
  return c.json(
    {
      message: error.message || "internal server error"
    },
    500
  );
});

const port = Number(process.env.PORT ?? 8787);

assertRequiredConfig();

serve({
  fetch: app.fetch,
  port
});

console.log(`@netaverses/api listening on :${port}`);
