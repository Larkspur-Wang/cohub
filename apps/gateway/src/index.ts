import "dotenv/config";
import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type {
  GatewayInboundEvent,
  GatewayOutboundCommand,
  RealtimeEnvelope,
  RealtimeServerEvent,
  WsClientEvent,
} from "@cohub/protocol";
import { realtimeEnvelopeSchema, wsClientEventSchema } from "@cohub/protocol";
import { authenticateRealtimeToken, type RealtimeAuthResult } from "./api-client.js";
import { listenOutboundCommands, initOutboundConsumerGroup, INBOUND_STREAM, OUTBOUND_STREAM, publishInboundEvent } from "./bus.js";
import { gatewayConfig } from "./config.js";
import { GatewayManager } from "./manager/index.js";
import {
  createBlockingRedisClient,
  createPubSubRedisClient,
  redisCommandClient,
  xaddWithMaxlen,
  GATEWAY_WS_BROADCAST_CHANNEL,
} from "./redis.js";

type WsConnectionContext = {
  connectionId: string;
  userId?: string;
  userName?: string;
  token?: string;
};

type GatewayWsBroadcastPayload = RealtimeServerEvent & {
  payload: RealtimeServerEvent["payload"] & {
    targetUserIds?: string[];
    targetConnectionId?: string | null;
  };
};

const WS_CONNECTION_TTL_SECONDS = 60 * 5;
const WS_MAX_MESSAGE_BYTES = 64 * 1024;

const wsConnections = new Map<string, WsConnectionContext>();
const wsConnectionsByUserId = new Map<string, Set<string>>();
const wsSockets = new Map<string, WebSocket>();

const getWsConnectionKey = (connectionId: string) => `gateway:ws:connection:${connectionId}`;
const getWsUserConnectionsKey = (userId: string) => `gateway:ws:user:${userId}:connections`;

function logStartupInfo() {
  console.log("=".repeat(60));
  console.log("[Gateway] Starting with configuration:");
  console.log(`  NODE_ID: ${process.env.POD_NAME || process.env.HOSTNAME || "unknown"}`);
  console.log(`  ENV: ${process.env.ENV || "unknown"}`);
  console.log(`  DEBUG_MODE: ${process.env.DEBUG_MODE || "false"}`);
  console.log(`  REDIS_URL: ${process.env.REDIS_URL ? `${process.env.REDIS_URL.slice(0, 30)}...` : "not set"}`);
  console.log(`  API_BASE_URL: ${gatewayConfig.apiBaseUrl}`);
  console.log(`  PORT: ${gatewayConfig.port}`);
  console.log("=".repeat(60));
}

const addUserConnection = (userId: string, connectionId: string) => {
  let set = wsConnectionsByUserId.get(userId);
  if (!set) {
    set = new Set<string>();
    wsConnectionsByUserId.set(userId, set);
  }
  set.add(connectionId);
};

const removeUserConnection = (userId: string, connectionId: string) => {
  const set = wsConnectionsByUserId.get(userId);
  if (!set) return;
  set.delete(connectionId);
  if (set.size === 0) wsConnectionsByUserId.delete(userId);
};

const persistWsConnection = async (ctx: WsConnectionContext) => {
  await redisCommandClient.set(getWsConnectionKey(ctx.connectionId), JSON.stringify({
    connectionId: ctx.connectionId,
    userId: ctx.userId ?? null,
    userName: ctx.userName ?? null,
    connectedAt: Date.now(),
    nodeId: process.env.POD_NAME || process.env.HOSTNAME || "unknown",
  }), "EX", WS_CONNECTION_TTL_SECONDS);
  if (ctx.userId) {
    await redisCommandClient.sadd(getWsUserConnectionsKey(ctx.userId), ctx.connectionId);
    await redisCommandClient.expire(getWsUserConnectionsKey(ctx.userId), WS_CONNECTION_TTL_SECONDS);
  }
};

const cleanupWsConnection = async (ctx: WsConnectionContext | undefined) => {
  if (!ctx) return;
  wsSockets.delete(ctx.connectionId);
  wsConnections.delete(ctx.connectionId);
  await redisCommandClient.del(getWsConnectionKey(ctx.connectionId)).catch(() => undefined);
  if (ctx.userId) {
    removeUserConnection(ctx.userId, ctx.connectionId);
    await redisCommandClient.srem(getWsUserConnectionsKey(ctx.userId), ctx.connectionId).catch(() => undefined);
  }
};

const sendWsEnvelope = (socket: WebSocket, envelope: RealtimeEnvelope) => {
  socket.send(JSON.stringify(envelope));
};

const buildRealtimeEnvelope = (input: Omit<RealtimeEnvelope, "id" | "timestamp">): RealtimeEnvelope => ({
  id: randomUUID(),
  timestamp: Date.now(),
  ...input,
});

const sendWsError = (
  socket: WebSocket,
  code: string,
  message: string,
  requestId?: string,
  options?: { spaceId?: string | null; sessionId?: string | null; clientMessageId?: string | null },
) => {
  const isSessionScoped = Boolean(options?.sessionId);
  sendWsEnvelope(socket, buildRealtimeEnvelope({
    domain: isSessionScoped ? "session" : "system",
    type: isSessionScoped ? "session.request.error" : "system.request.error",
    requestId: requestId ?? null,
    spaceId: options?.spaceId ?? null,
    sessionId: options?.sessionId ?? null,
    payload: isSessionScoped
      ? { code, message, clientMessageId: options?.clientMessageId ?? null }
      : { code, message },
  }));
};

const parseWsJson = (value: string): WsClientEvent => {
  const result = wsClientEventSchema.safeParse(JSON.parse(value));
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data as WsClientEvent;
};

const touchWsConnection = async (ctx: WsConnectionContext) => {
  await redisCommandClient.expire(getWsConnectionKey(ctx.connectionId), WS_CONNECTION_TTL_SECONDS).catch(() => undefined);
  if (ctx.userId) {
    await redisCommandClient.sadd(getWsUserConnectionsKey(ctx.userId), ctx.connectionId).catch(() => undefined);
    await redisCommandClient.expire(getWsUserConnectionsKey(ctx.userId), WS_CONNECTION_TTL_SECONDS).catch(() => undefined);
  }
};

const startWsConnectionSweeper = () => {
  setInterval(async () => {
    const now = Date.now();
    for (const [connectionId, ctx] of wsConnections.entries()) {
      const raw = await redisCommandClient.get(getWsConnectionKey(connectionId)).catch(() => null);
      if (raw) continue;
      const socket = wsSockets.get(connectionId);
      if (socket && socket.readyState === socket.OPEN) {
        socket.close(4001, `expired:${now}`);
      }
      await cleanupWsConnection(ctx);
    }
  }, 30_000);
};

class WsClientInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WsClientInputError";
  }
}

function fanOutBroadcastToLocalSockets(payload: GatewayWsBroadcastPayload) {
  const targetUserIds = Array.isArray(payload.payload?.targetUserIds)
    ? payload.payload.targetUserIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  for (const userId of targetUserIds) {
    const connectionIds = wsConnectionsByUserId.get(userId);
    if (!connectionIds) continue;
    for (const connectionId of connectionIds) {
      const socket = wsSockets.get(connectionId);
      if (!socket) continue;
      const { targetUserIds: _targetUserIds, targetConnectionId: _targetConnectionId, ...cleanPayload } = payload.payload ?? {};
      sendWsEnvelope(socket, {
        ...payload,
        payload: cleanPayload,
      } as RealtimeEnvelope);
    }
  }
}

async function startSpaceOutputSubscriber() {
  const client = createPubSubRedisClient();
  if (client.status === "wait") {
    await client.connect();
  }

  await client.subscribe(GATEWAY_WS_BROADCAST_CHANNEL);
  client.on("message", (channel, message) => {
    if (channel !== GATEWAY_WS_BROADCAST_CHANNEL) return;
    try {
      const parsed = realtimeEnvelopeSchema.safeParse(JSON.parse(message));
      if (!parsed.success) {
        console.error("[Gateway] Invalid WS broadcast payload:", parsed.error.issues);
        return;
      }
      fanOutBroadcastToLocalSockets(parsed.data as GatewayWsBroadcastPayload);
    } catch (error) {
      console.error("[Gateway] Failed to handle WS broadcast payload:", error);
    }
  });
}

const buildWebsocketBindingKey = (spaceId: string, sessionId: string) => `websocket:space:${spaceId}:session:${sessionId}`;

const publishWebsocketInboundMessage = async (ctx: WsConnectionContext, requestId: string | undefined, payload: Record<string, unknown>) => {
  const spaceId = typeof payload.spaceId === "string" ? payload.spaceId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const clientMessageId = typeof payload.clientMessageId === "string" && payload.clientMessageId.trim()
    ? payload.clientMessageId.trim()
    : randomUUID();
  const content = Array.isArray(payload.content)
    ? payload.content as GatewayInboundEvent["content"]
    : [];
  const model = typeof payload.model === "string" && payload.model.trim()
    ? payload.model.trim()
    : null;
  const provider = typeof payload.provider === "string" && payload.provider.trim()
    ? payload.provider.trim()
    : null;

  if (!spaceId || !sessionId) throw new WsClientInputError("spaceId and sessionId are required");
  if (content.length === 0) throw new WsClientInputError("content is required");

  const event: GatewayInboundEvent = {
    eventId: randomUUID(),
    timestamp: Date.now(),
    eventType: "message_create",
    channelId: sessionId,
    provider: "websocket",
    externalChatId: sessionId,
    externalMessageId: clientMessageId,
    bindingKey: buildWebsocketBindingKey(spaceId, sessionId),
    conversation: {
      id: sessionId,
      parentId: null,
      meta: { spaceId, source: "websocket" },
    },
    message: {
      parentMessageId: null,
      meta: { requestId: requestId ?? null, connectionId: ctx.connectionId },
    },
    sender: {
      id: ctx.userId ?? "anonymous",
      name: ctx.userName,
    },
    content,
    meta: {
      source: "websocket",
      authToken: ctx.token ?? null,
      userId: ctx.userId ?? null,
      connectionId: ctx.connectionId,
      requestId: requestId ?? null,
      spaceId,
      sessionId,
      clientMessageId,
      model,
      provider,
    },
  };

  await publishInboundEvent(event);
};

async function main() {
  logStartupInfo();

  await initOutboundConsumerGroup();
  startWsConnectionSweeper();
  await startSpaceOutputSubscriber();

  const manager = new GatewayManager();
  await manager.start();

  console.log("[Gateway] Listening for outbound commands from API...");

  listenOutboundCommands(async (cmd: GatewayOutboundCommand) => {
    console.log("[Gateway] Received outbound command:", {
      commandId: cmd.commandId,
      channelId: cmd.channelId,
      provider: cmd.provider,
      externalChatId: cmd.externalChatId,
      contentPreview: cmd.content.map((c) => c.type).join(", "),
    });

    if (cmd.provider === "websocket") {
      const targetConnectionId = typeof cmd.meta?.targetConnectionId === "string" ? cmd.meta.targetConnectionId.trim() : "";
      const targetUserIds = Array.isArray(cmd.meta?.targetUserIds)
        ? (cmd.meta.targetUserIds as unknown[]).filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const payload = {
        ...(cmd.meta?.payload && typeof cmd.meta.payload === "object" ? cmd.meta.payload as Record<string, unknown> : {}),
        targetUserIds,
        targetConnectionId: targetConnectionId || null,
      };
      const domain = cmd.meta?.domain === "system" || cmd.meta?.domain === "space" || cmd.meta?.domain === "session"
        ? cmd.meta.domain
        : "session";
      const envelope = buildRealtimeEnvelope({
        domain,
        type: typeof cmd.meta?.type === "string" ? cmd.meta.type : "session.message.persisted",
        requestId: typeof cmd.meta?.requestId === "string" ? cmd.meta.requestId : null,
        spaceId: cmd.spaceId ?? null,
        sessionId: cmd.spaceSessionId ?? null,
        payload,
      });

      if (targetConnectionId) {
        const socket = wsSockets.get(targetConnectionId);
        if (!socket) {
          return { success: true, externalMessageId: targetConnectionId, error: "offline" };
        }
        const { targetUserIds: _targetUserIds, targetConnectionId: _targetConnectionId, ...cleanPayload } = envelope.payload as Record<string, unknown>;
        sendWsEnvelope(socket, { ...envelope, payload: cleanPayload });
        return { success: true, externalMessageId: targetConnectionId };
      }

      let delivered = 0;
      for (const userId of targetUserIds) {
        const connectionIds = wsConnectionsByUserId.get(userId);
        if (!connectionIds) continue;
        for (const connectionId of connectionIds) {
          const socket = wsSockets.get(connectionId);
          if (!socket) continue;
          const { targetUserIds: _targetUserIds, targetConnectionId: _targetConnectionId, ...cleanPayload } = envelope.payload as Record<string, unknown>;
          sendWsEnvelope(socket, { ...envelope, payload: cleanPayload });
          delivered += 1;
        }
      }

      return { success: true, externalMessageId: String(delivered) };
    }

    const provider = manager.getProvider(cmd.channelId);
    if (!provider) {
      console.warn(`[Gateway] Command rejected: provider not found for channel ${cmd.channelId}`);
      console.warn(`[Gateway] Active channels: ${manager.getActiveChannelIds().join(", ") || "none"}`);
      return { success: false, error: `Provider not found for channel ${cmd.channelId}` };
    }

    console.log(`[Gateway] Routing command ${cmd.commandId} to ${cmd.provider} provider`);
    const result = await provider.handleOutbound(cmd);
    console.log(`[Gateway] Command ${cmd.commandId} result:`, result.success ? "success" : `failed: ${result.error}`);
    return result;
  }).catch((error) => {
    console.error("[Gateway] Fatal error listening to outbound stream:", error);
  });

  const app = new Hono();
  app.use("*", cors());

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    const checks: Record<string, boolean> = {};
    try {
      await redisCommandClient.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }
    checks.manager = manager.started;
    return c.json({ ready: Object.values(checks).every(Boolean), checks }, Object.values(checks).every(Boolean) ? 200 : 503);
  });

  const server = serve({ fetch: app.fetch, port: gatewayConfig.port }) as unknown as import("node:http").Server;
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: WebSocket) => {
    const connectionId = randomUUID();
    const ctx: WsConnectionContext = { connectionId };
    wsConnections.set(connectionId, ctx);
    wsSockets.set(connectionId, socket);
    sendWsEnvelope(socket, buildRealtimeEnvelope({
      domain: "system",
      type: "system.ready",
      payload: { connectionId },
    }));

    socket.on("message", async (data: RawData) => {
      try {
        const raw = typeof data === "string"
          ? data
          : Buffer.isBuffer(data)
            ? data.toString("utf-8")
            : Array.isArray(data)
              ? Buffer.concat(data.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf-8")
              : Buffer.from(data).toString("utf-8");
        if (Buffer.byteLength(raw, "utf-8") > WS_MAX_MESSAGE_BYTES) {
          sendWsError(socket, "MESSAGE_TOO_LARGE", "message too large");
          return;
        }

        const message = parseWsJson(raw);
        const requestId = typeof message.requestId === "string" ? message.requestId : undefined;

        if (message.type === "ping") {
          await touchWsConnection(ctx);
          sendWsEnvelope(socket, buildRealtimeEnvelope({
            domain: "system",
            type: "system.pong",
            requestId: requestId ?? null,
            payload: {},
          }));
          return;
        }

        if (message.type === "auth") {
          const token = typeof message.payload?.token === "string" ? message.payload.token.trim() : "";
          if (!token) {
            sendWsError(socket, "UNAUTHORIZED", "token is required", requestId);
            return;
          }
          const result: RealtimeAuthResult = await authenticateRealtimeToken({ token });
          if (!result.ok) {
            sendWsError(socket, "UNAUTHORIZED", result.error.message, requestId);
            return;
          }
          ctx.userId = result.user.uuid;
          ctx.userName = typeof result.user.nick_name === "string" ? result.user.nick_name : undefined;
          ctx.token = token;
          addUserConnection(result.user.uuid, connectionId);
          await persistWsConnection(ctx);
          sendWsEnvelope(socket, buildRealtimeEnvelope({
            domain: "system",
            type: "system.auth.ok",
            requestId: requestId ?? null,
            payload: { connectionId, user: result.user },
          }));
          return;
        }

        if (!ctx.userId || !ctx.token) {
          sendWsError(socket, "UNAUTHORIZED", "authentication required", requestId);
          return;
        }

        await touchWsConnection(ctx);

        if (message.type === "session.message.create") {
          await publishWebsocketInboundMessage(ctx, requestId, message.payload ?? {});
          sendWsEnvelope(socket, buildRealtimeEnvelope({
            domain: "session",
            type: "session.request.accepted",
            requestId: requestId ?? null,
            spaceId: typeof message.payload?.spaceId === "string" ? message.payload.spaceId : null,
            sessionId: typeof message.payload?.sessionId === "string" ? message.payload.sessionId : null,
            payload: {
              clientMessageId: typeof message.payload?.clientMessageId === "string" ? message.payload.clientMessageId : null,
            },
          }));
          return;
        }

        if (message.type === "ack") {
          sendWsEnvelope(socket, buildRealtimeEnvelope({
            domain: "system",
            type: "system.ack.ok",
            requestId: requestId ?? null,
            payload: {},
          }));
          return;
        }

        sendWsError(socket, "UNSUPPORTED_EVENT", "unsupported event type", requestId);
      } catch (error) {
        const requestId = undefined;
        if (error instanceof WsClientInputError) {
          sendWsError(socket, "BAD_REQUEST", error.message, requestId);
          return;
        }
        console.error("[Gateway] WebSocket message handling failed:", error);
        sendWsError(socket, "INTERNAL_ERROR", "internal error", requestId);
      }
    });

    socket.on("close", () => {
      void cleanupWsConnection(wsConnections.get(connectionId));
    });
    socket.on("error", () => {
      void cleanupWsConnection(wsConnections.get(connectionId));
    });
  });

  console.log(`@cohub/gateway listening on :${gatewayConfig.port}`);

  const shutdown = async () => {
    console.log("[Gateway] Received shutdown signal, stopping...");
    await manager.stop();
    console.log("[Gateway] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  if (process.env.DEBUG_MODE === "true") {
    console.log("[Gateway] DEBUG_MODE enabled.");

    const startDebugProvider = async (channelId: string, providerType: string, credential: string | { appId: string; appSecret: string; brand?: string }) => {
      console.log(`[Debug] Initializing test channel: ${channelId} (${providerType})`);

      if (providerType === "discord" && typeof credential === "string") {
        const { DiscordProvider } = await import("./providers/discord/index.js");
        const provider = new DiscordProvider(channelId, credential);
        // @ts-expect-error
        manager.providers.set(channelId, provider);
      } else if (providerType === "feishu" && typeof credential === "object") {
        const { FeishuProvider } = await import("./providers/feishu/index.js");
        const provider = new FeishuProvider(channelId, {
          appId: credential.appId,
          appSecret: credential.appSecret,
          brand: (credential.brand as "feishu" | "lark") ?? "feishu",
        });
        // @ts-expect-error
        manager.providers.set(channelId, provider);
      }
    };

    if (process.env.DEBUG_DISCORD_BOT_TOKEN) {
      await startDebugProvider("debug-discord", "discord", process.env.DEBUG_DISCORD_BOT_TOKEN);
    }
    if (process.env.DEBUG_TELEGRAM_BOT_TOKEN) {
      await startDebugProvider("debug-telegram", "telegram", process.env.DEBUG_TELEGRAM_BOT_TOKEN);
    }
    if (process.env.DEBUG_FEISHU_APP_ID) {
      await startDebugProvider("debug-feishu", "feishu", {
        appId: process.env.DEBUG_FEISHU_APP_ID,
        appSecret: process.env.DEBUG_FEISHU_APP_SECRET ?? "",
        brand: process.env.DEBUG_FEISHU_BRAND ?? "feishu",
      });
    }

    const redis = createBlockingRedisClient();
    await redis.connect().catch(() => undefined);

    (async () => {
      let lastId = "$";
      while (true) {
        const result = await redis.xread("BLOCK", 0, "STREAMS", INBOUND_STREAM, lastId);
        if (!result) continue;
        for (const [, messages] of result) {
          for (const [id, fields] of messages) {
            lastId = id;
            const payloadIdx = fields.indexOf("payload");
            const payloadStr = payloadIdx >= 0 ? fields[payloadIdx + 1] : undefined;
            if (!payloadStr) continue;

            const payload = JSON.parse(payloadStr) as GatewayInboundEvent;
            if (payload.channelId.startsWith("debug-")) {
              console.log(`[Debug] Received ping from ${payload.sender.name} via ${payload.provider}, sending pong...`);
              const pongCmd: GatewayOutboundCommand = {
                commandId: `pong-${Date.now()}`,
                timestamp: Date.now(),
                channelId: payload.channelId,
                provider: payload.provider,
                externalChatId: payload.externalChatId,
                content: [{ type: "text", text: `pong from ${payload.provider} 🏓` }],
                replyToExternalMessageId: payload.externalMessageId,
              };
              await xaddWithMaxlen(redis, OUTBOUND_STREAM, "*", "payload", JSON.stringify(pongCmd));
            }
          }
        }
      }
    })().catch(console.error);
  }
}

main().catch(console.error);
