import "dotenv/config";
import "./tracing.js";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from "@hono/otel";

import { verifyUserAccessToken } from "@cohub/auth";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { getTracer, extractTrace } from "@cohub/tracing/propagator";
import { getTokenFromRequest, type AuthUserProfile, consumeExecutionAuthFromToken, type ExecutionAuthPrincipal } from "./auth.js";
import { UnauthorizedError } from "./lib/middleware.js";
import { assertRequiredConfig, config } from "./config.js";
import {
  createBlockingRedisClient,
  ensureConsumerGroup,
  GATEWAY_INBOUND_STREAM,
  AGENT_SESSION_UPDATES_STREAM,
  SPACE_EVENTS_STREAM,
  INBOUND_CONSUMER_GROUP,
  SESSION_UPDATES_CONSUMER_GROUP,
  SPACE_EVENTS_CONSUMER_GROUP,
} from "./redis.js";
import { bindAllActiveSpaceChannelsToGateway, handleInboundEvent, handleWebsocketInboundEvent } from "./channels.js";
import { gatewayInboundEventSchema } from "@neta-art/cohub-protocol/gateway";
import type { SessionStreamError, SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import { buildSessionOutputsForStreamEvent, dispatchSessionOutputs } from "./session-output.js";
import { dispatchSpaceFsChanged, type SpaceFsChangedStreamEvent } from "./space-events.js";
import router from "./routes/index.js";

const tracer = getTracer("cohub-api");

// ── Gateway inbound listener (background task) ───────────────────────────────

const CONSUMER_NAME = `api-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const INBOUND_BATCH_SIZE = 10;
const INBOUND_BLOCK_MS = 5000;
const SESSION_UPDATES_BATCH_SIZE = 50;
const SESSION_UPDATES_BLOCK_MS = 5000;
const SPACE_EVENTS_BATCH_SIZE = 50;
const SPACE_EVENTS_BLOCK_MS = 5000;
const GATEWAY_BINDING_RECONCILE_INTERVAL_MS = Number(process.env.GATEWAY_BINDING_RECONCILE_INTERVAL_MS ?? 60_000);

const initInboundConsumerGroup = async () => {
  await ensureConsumerGroup(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, "0");
};

const startGatewayInboundListener = async () => {
  await initInboundConsumerGroup();
  const client = createBlockingRedisClient();
  await client.connect();
  while (true) {
    try {
      const entries = await client.xreadgroup(
        "GROUP",
        INBOUND_CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        INBOUND_BATCH_SIZE,
        "BLOCK",
        INBOUND_BLOCK_MS,
        "STREAMS",
        GATEWAY_INBOUND_STREAM,
        ">",
      );
      if (!entries || entries.length === 0) continue;
      for (const [, messages] of entries as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of messages) {
          const payloadIndex = fields.indexOf("payload");
          const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payload) continue;
          try {
            const parsed = gatewayInboundEventSchema.safeParse(JSON.parse(payload));
            if (!parsed.success) {
              console.error("[API] Invalid gateway inbound event:", parsed.error.issues);
              await client.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
              continue;
            }
            const event = parsed.data;
            // Extract trace context from the message (injected by Gateway)
            const parentCtx = extractTrace(event as unknown as Record<string, unknown>);
            const span = tracer.startSpan("api.inbound.consume", {
              attributes: {
                "event.id": event.eventId,
                "event.type": event.eventType,
                "channel.id": event.channelId,
                "provider": event.provider,
              },
            });
            try {
              await context.with(trace.setSpan(parentCtx, span), async () => {
                if (event.provider === "websocket") {
                  await handleWebsocketInboundEvent(event);
                } else {
                  await handleInboundEvent(event);
                }
              });
            } catch (err) {
              recordSpanError(span, err);
              throw err;
            } finally {
              span.end();
            }
            await client.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
          } catch (err) {
            console.error("[API] Failed to process inbound event:", err);
            await client.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id).catch(() => undefined);
          }
        }
      }
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

const startSessionUpdatesBridge = async () => {
  await ensureConsumerGroup(AGENT_SESSION_UPDATES_STREAM, SESSION_UPDATES_CONSUMER_GROUP, "0");
  const client = createBlockingRedisClient();
  await client.connect();
  while (true) {
    try {
      const entries = await client.xreadgroup(
        "GROUP",
        SESSION_UPDATES_CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        SESSION_UPDATES_BATCH_SIZE,
        "BLOCK",
        SESSION_UPDATES_BLOCK_MS,
        "STREAMS",
        AGENT_SESSION_UPDATES_STREAM,
        ">",
      );
      if (!entries || entries.length === 0) continue;
      for (const [, messages] of entries as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of messages) {
          const payloadIndex = fields.indexOf("payload");
          const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payload) {
            await client.xack(AGENT_SESSION_UPDATES_STREAM, SESSION_UPDATES_CONSUMER_GROUP, id).catch(() => undefined);
            continue;
          }
          const event = JSON.parse(payload) as SessionStreamEvent | SessionStreamError;
          if (event.type !== "stream_update" && event.type !== "error") {
            await client.xack(AGENT_SESSION_UPDATES_STREAM, SESSION_UPDATES_CONSUMER_GROUP, id);
            continue;
          }

          try {
            // Extract trace context from the message (injected by Agent)
            const parentCtx = extractTrace(event as unknown as Record<string, unknown>);
            const span = tracer.startSpan("api.session_updates.consume", {
              attributes: {
                "event.type": event.type,
                "space.id": event.spaceId,
                "session.id": (event as { sessionId?: string }).sessionId ?? "",
              },
            });
            try {
              await context.with(trace.setSpan(parentCtx, span), async () => {
                const outputs = await buildSessionOutputsForStreamEvent(event);
                await dispatchSessionOutputs(outputs);
              });
            } catch (err) {
              recordSpanError(span, err);
              throw err;
            } finally {
              span.end();
            }
            await client.xack(AGENT_SESSION_UPDATES_STREAM, SESSION_UPDATES_CONSUMER_GROUP, id);
          } catch (error) {
            console.error("[API] Failed to bridge agent session update event:", error);
          }
        }
      }
    } catch (error) {
      console.error("[API] Agent session updates bridge error:", error);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

const startSpaceEventsBridge = async () => {
  await ensureConsumerGroup(SPACE_EVENTS_STREAM, SPACE_EVENTS_CONSUMER_GROUP, "0");
  const client = createBlockingRedisClient();
  await client.connect();
  while (true) {
    try {
      const entries = await client.xreadgroup(
        "GROUP",
        SPACE_EVENTS_CONSUMER_GROUP,
        CONSUMER_NAME,
        "COUNT",
        SPACE_EVENTS_BATCH_SIZE,
        "BLOCK",
        SPACE_EVENTS_BLOCK_MS,
        "STREAMS",
        SPACE_EVENTS_STREAM,
        ">",
      );
      if (!entries || entries.length === 0) continue;
      for (const [, messages] of entries as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of messages) {
          const payloadIndex = fields.indexOf("payload");
          const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
          if (!payload) {
            await client.xack(SPACE_EVENTS_STREAM, SPACE_EVENTS_CONSUMER_GROUP, id).catch(() => undefined);
            continue;
          }
          try {
            const event = JSON.parse(payload) as SpaceFsChangedStreamEvent;
            if (event.type === "space.fs.changed" && event.spaceId) {
              await dispatchSpaceFsChanged(event.spaceId, event.payload);
            }
            await client.xack(SPACE_EVENTS_STREAM, SPACE_EVENTS_CONSUMER_GROUP, id);
          } catch (error) {
            console.error("[API] Failed to bridge space event:", error);
            // Do not ACK on dispatch/permission failures. Keep the event pending so
            // it can be retried by this or a future consumer instead of silently
            // dropping collaborative invalidation signals.
          }
        }
      }
    } catch (error) {
      console.error("[API] Space events bridge error:", error);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

startGatewayInboundListener().catch(console.error);
startSessionUpdatesBridge().catch(console.error);
startSpaceEventsBridge().catch(console.error);

const reconcileGatewayBindings = async (reason: string) => {
  try {
    const stats = await bindAllActiveSpaceChannelsToGateway();
    if (reason === "startup" || stats.failed > 0) {
      console.log(
        `[API] Gateway channel binding reconcile (${reason}): total=${stats.total} bound=${stats.bound} skipped=${stats.skipped} failed=${stats.failed}`,
      );
    }
  } catch (error) {
    console.warn(`[API] Gateway channel binding reconcile failed (${reason}):`, error);
  }
};

setTimeout(() => {
  void reconcileGatewayBindings("startup");
}, 2_000);

if (GATEWAY_BINDING_RECONCILE_INTERVAL_MS > 0) {
  setInterval(() => {
    void reconcileGatewayBindings("interval");
  }, GATEWAY_BINDING_RECONCILE_INTERVAL_MS);
}

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

const recordSpanError = (span: ReturnType<typeof tracer.startSpan>, error: unknown) => {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
};

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

app.onError((error, c) => {
  if (error instanceof UnauthorizedError) {
    return c.json({ message: error.message }, 401);
  }
  const path = c.req.path;
  const method = c.req.method;
  console.error(`[API Error] ${method} ${path}:`, {
    message: error.message,
    stack: error.stack,
    name: error.name,
  });
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
