import "dotenv/config";
import "./tracing.js";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from "@hono/otel";

import { verifyUserAccessToken } from "@cohub/core/auth";

import { getTokenFromRequest, type AuthUserProfile, consumeExecutionAuthFromToken, type ExecutionAuthPrincipal } from "./auth.js";
import { UnauthorizedError } from "./lib/middleware.js";
import { assertRequiredConfig, config } from "./config.js";

import router from "./routes/index.js";

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono<{
  Variables: {
    token: string | null;
    authUser: AuthUserProfile | null;
    executionAuth: ExecutionAuthPrincipal | null;
    principal: { type: "user"; user: AuthUserProfile } | { type: "execution"; execution: ExecutionAuthPrincipal } | null;
  };
}>();

app.use(
  "*",
  httpInstrumentationMiddleware({
    serviceName: "cohub-api",
    serviceVersion: process.env.IMAGE_TAG ?? "latest",
    captureRequestHeaders: ["authorization"],
  }),
);

app.use(
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Git-Token"],
    credentials: true,
  }),
);

app.use(async (c, next) => {
  const token = getTokenFromRequest(c);
  c.set("token", token);
  c.set("authUser", null);
  c.set("executionAuth", null);
  c.set("principal", null);

  if (token) {
    const executionAuth = await consumeExecutionAuthFromToken(token).catch((error) => {
      console.warn("[API] Failed to verify execution token:", error);
      return null;
    });
    if (executionAuth) {
      c.set("executionAuth", executionAuth);
      c.set("principal", { type: "execution", execution: executionAuth });
      await next();
      return;
    }

    try {
      const authUser = await verifyUserAccessToken({ token, logtoEndpoint: config.logtoEndpoint });
      c.set("authUser", authUser);
      c.set("principal", { type: "user", user: authUser });
    } catch {
      c.set("authUser", null);
    }
  }

  await next();
});

app.route("/", router);

const serializeErrorForLog = (error: unknown): unknown => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: serializeErrorForLog(error.cause),
    };
  }
  if (error === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(error));
  } catch {
    return String(error);
  }
};

app.onError((error, c) => {
  if (error instanceof UnauthorizedError) {
    return c.json({ message: error.message }, 401);
  }
  const path = c.req.path;
  const method = c.req.method;
  console.error(`[API Error] ${method} ${path}:`, serializeErrorForLog(error));
  return c.json({ message: error.message || "internal server error" }, 500);
});

// ── Start server ─────────────────────────────────────────────────────────────

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
