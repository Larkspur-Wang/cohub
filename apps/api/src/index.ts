import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { fetchAuthUser, getTokenFromRequest, type AuthUserProfile } from "./auth.js";
import { assertRequiredConfig } from "./config.js";
import {
  createBlockingRedisClient,
  ensureConsumerGroup,
  GATEWAY_INBOUND_STREAM,
  AGENT_SESSION_UPDATES_STREAM,
  INBOUND_CONSUMER_GROUP,
  SESSION_UPDATES_CONSUMER_GROUP,
} from "./redis.js";
import { handleInboundEvent, handleWebsocketInboundEvent } from "./channels.js";
import type { GatewayInboundEvent } from "@cohub/protocol/gateway";
import type { SessionStreamError, SessionStreamEvent } from "@cohub/protocol/realtime";
import { buildSessionOutputsForStreamEvent, dispatchSessionOutputs } from "./session-output.js";
import router from "./routes/index.js";

// ── Gateway inbound listener (background task) ───────────────────────────────

const CONSUMER_NAME = `api-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const INBOUND_BATCH_SIZE = 10;
const INBOUND_BLOCK_MS = 5000;
const SESSION_UPDATES_BATCH_SIZE = 50;
const SESSION_UPDATES_BLOCK_MS = 5000;

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
            const event = JSON.parse(payload) as GatewayInboundEvent;
            if (event.provider === "websocket") {
              await handleWebsocketInboundEvent(event);
            } else {
              await handleInboundEvent(event);
            }
            await client.xack(GATEWAY_INBOUND_STREAM, INBOUND_CONSUMER_GROUP, id);
          } catch {
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
            const outputs = await buildSessionOutputsForStreamEvent(event);
            await dispatchSessionOutputs(outputs);
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

startGatewayInboundListener().catch(console.error);
startSessionUpdatesBridge().catch(console.error);

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono<{
  Variables: {
    token: string | null;
    authUser: AuthUserProfile | null;
  };
}>();

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
  if (token) {
    try {
      c.set("authUser", await fetchAuthUser(token));
    } catch {
      c.set("authUser", null);
    }
  } else {
    c.set("authUser", null);
  }
  await next();
});

app.route("/", router);

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
