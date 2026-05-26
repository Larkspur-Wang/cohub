import "dotenv/config";
import "./tracing.js";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { trace } from "@opentelemetry/api";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from "@hono/otel";

import { applyTraceResponseHeaders, getActiveTraceIdentifiers, getOrCreateRequestId, runWithRequestTraceContext, setRequestContextAttributes } from "@cohub/infra/tracing";
import { verifyUserAccessToken } from "@cohub/identity";

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
    requestId: string;
    traceId: string | null;
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

app.use(async (c, next) => {
  const requestId = getOrCreateRequestId(c.req.header("x-request-id"));
  c.set("requestId", requestId);
  await runWithRequestTraceContext({ requestId }, next);
  const ids = getActiveTraceIdentifiers(requestId);
  c.set("traceId", ids.traceId);
  setRequestContextAttributes(trace.getActiveSpan(), ids);
  applyTraceResponseHeaders(c.res.headers, ids);
});

app.use(
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Git-Token", "X-Request-Id", "Traceparent"],
    exposeHeaders: ["X-Request-Id", "X-Trace-Id", "X-Span-Id", "Traceparent"],
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
      return c.json({ message: "unauthorized" }, 401);
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

app.notFound((c) => c.json({ message: "not found" }, 404));

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? getOrCreateRequestId(c.req.header("x-request-id"));
  const ids = getActiveTraceIdentifiers(requestId);
  setRequestContextAttributes(trace.getActiveSpan(), ids);
  applyTraceResponseHeaders(c.res.headers, ids);

  if (error instanceof UnauthorizedError) {
    return c.json({ message: error.message, requestId, traceId: ids.traceId }, 401);
  }
  const path = c.req.path;
  const method = c.req.method;
  console.error(`[API Error] ${method} ${path} requestId=${requestId} traceId=${ids.traceId ?? "none"}:`, serializeErrorForLog(error));
  return c.json({ message: "internal server error", requestId, traceId: ids.traceId }, 500);
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
