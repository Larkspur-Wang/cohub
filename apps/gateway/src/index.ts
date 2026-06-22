import "dotenv/config";
import "./tracing.js";
import { createLogger } from "@cohub/infra/logging";


import { randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { ContentBlock } from "@cohub/protocol/core";
import type {
  RealtimeCompactFrame,
  RealtimeEnvelope,
  RealtimePatchOperation,
  RealtimeServerEvent,
  WsClientEvent,
} from "@cohub/protocol/realtime";

import type { PlannedGatewayOutboundCommand } from "@cohub/protocol/gateway";
import {
  getSessionTurnPatchStreamKey,
  realtimeEnvelopeSchema,
  WS_COMPACT_STREAM_CAPABILITY,
  wsClientEventSchema,
} from "@cohub/protocol/realtime";
import { getOrCreateRequestId } from "@cohub/infra/tracing";
import { authenticateRealtimeToken, requestGatewayChannelReconcile, submitCanvasTransaction, submitInternalSessionPrompt, type RealtimeAuthResult } from "./api-client.js";
import { listenOutboundCommands, initOutboundConsumerGroup } from "./bus.js";
import { summarizeRedisUrl } from "./logging.js";
import { gatewayConfig } from "./config.js";
import { GatewayManager } from "./manager/index.js";
import { handleAsrWebSocketConnection } from "./asr/session.js";
import {
  createPubSubRedisClient,
  redisCommandClient,
  REALTIME_OUTBOUND_CHANNEL,
  AGENT_REALTIME_PATCH_CHANNEL,
  getSpaceWsUsersKey,
} from "./redis.js";

const logger = createLogger({ serviceName: "cohub-gateway" });
type WsConnectionContext = {
  connectionId: string;
  userId?: string;
  userName?: string;
  token?: string;
  capabilities: Set<string>;
  compactStreamAliases: Map<string, string>;
  nextCompactStreamAlias: number;
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
const SPACE_WS_USERS_CACHE_TTL_MS = 10_000;
const spaceWsUsersCache = new Map<string, { expiresAt: number; userIds: string[] }>();

const getWsConnectionKey = (connectionId: string) => `gateway:ws:connection:${connectionId}`;
const getWsUserConnectionsKey = (userId: string) => `gateway:ws:user:${userId}:connections`;

function logStartupInfo() {
  logger.info("=".repeat(60));
  logger.info("[Gateway] Starting with configuration:");
  logger.info(`  NODE_ID: ${process.env.POD_NAME || process.env.HOSTNAME || "unknown"}`);
  logger.info(`  ENV: ${process.env.ENV || "unknown"}`);
  logger.info(`  DEBUG_MODE: ${process.env.DEBUG_MODE || "false"}`);
  logger.info("  REDIS_URL", { redis: summarizeRedisUrl(process.env.REDIS_URL) });
  logger.info(`  API_BASE_URL: ${gatewayConfig.apiBaseUrl}`);
  logger.info(`  PORT: ${gatewayConfig.port}`);
  logger.info("=".repeat(60));
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
    capabilities: [...ctx.capabilities],
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

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const getPatchStreamId = (envelope: RealtimeEnvelope) => {
  if (envelope.type !== "session.turn.patch") return null;
  return getSessionTurnPatchStreamKey(envelope.payload);
};

const getPersistedTurnId = (envelope: RealtimeEnvelope) => {
  if (envelope.type !== "session.message.persisted") return null;
  const message = envelope.payload.message;
  if (!message || typeof message !== "object") return null;
  const meta = (message as { meta?: Record<string, unknown> | null }).meta;
  return typeof meta?.turnId === "string" && meta.turnId.trim()
    ? meta.turnId
    : null;
};

const buildCompactFrame = (envelope: RealtimeEnvelope, sid: string): RealtimeCompactFrame | null => {
  if (envelope.type !== "session.turn.patch") return null;
  const payload = envelope.payload as Record<string, unknown>;
  if (!isNonNegativeInteger(payload.seq) || !isNonNegativeInteger(payload.baseSeq)) return null;
  if (payload.baseSeq === 0) return null;
  if (!Array.isArray(payload.ops) || payload.ops.length !== 1) return null;

  const op = payload.ops[0] as Partial<RealtimePatchOperation> | undefined;
  if (!op || typeof op !== "object") return null;
  if (!("o" in op) && !("p" in op) && "v" in op) {
    return { t: "d", sid, s: payload.seq, b: payload.baseSeq, v: op.v };
  }
  if (op.o === "append" && typeof op.p === "string" && "v" in op) {
    return {
      t: "p",
      sid,
      s: payload.seq,
      b: payload.baseSeq,
      o: "append",
      p: op.p,
      v: op.v,
    };
  }
  return null;
};

const getOrCreateCompactStreamAlias = (ctx: WsConnectionContext, streamId: string) => {
  const existing = ctx.compactStreamAliases.get(streamId);
  if (existing) return existing;
  ctx.nextCompactStreamAlias += 1;
  const alias = ctx.nextCompactStreamAlias.toString(36);
  ctx.compactStreamAliases.set(streamId, alias);
  return alias;
};

const withCompactStreamMetadata = (
  envelope: RealtimeEnvelope,
  sid: string,
): RealtimeEnvelope => ({
  ...envelope,
  payload: {
    ...envelope.payload,
    _rt: { sid },
  },
});

const rememberRealtimeEnvelopeForConnection = (
  ctx: WsConnectionContext | undefined,
  envelope: RealtimeEnvelope,
) => {
  if (!ctx) return;
  const patchStreamId = getPatchStreamId(envelope);
  if (patchStreamId) {
    getOrCreateCompactStreamAlias(ctx, patchStreamId);
    return;
  }
  const persistedTurnId = getPersistedTurnId(envelope);
  if (persistedTurnId) ctx.compactStreamAliases.delete(persistedTurnId);
};

const sendWsRealtime = (
  socket: WebSocket,
  ctx: WsConnectionContext | undefined,
  envelope: RealtimeEnvelope,
) => {
  const streamId = ctx ? getPatchStreamId(envelope) : null;
  const canUseCompact = Boolean(
    ctx?.capabilities.has(WS_COMPACT_STREAM_CAPABILITY) && streamId,
  );
  const existingSid = canUseCompact && ctx && streamId
    ? ctx.compactStreamAliases.get(streamId)
    : null;
  if (ctx && streamId && existingSid) {
    const compactFrame = buildCompactFrame(envelope, existingSid);
    if (compactFrame) {
      socket.send(JSON.stringify(compactFrame));
      return;
    }
  }
  const envelopeToSend = ctx && streamId && canUseCompact
    ? withCompactStreamMetadata(envelope, getOrCreateCompactStreamAlias(ctx, streamId))
    : envelope;
  sendWsEnvelope(socket, envelopeToSend);
  rememberRealtimeEnvelopeForConnection(ctx, envelope);
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

const getSpaceWsUsers = async (spaceId: string) => {
  const now = Date.now();
  const cached = spaceWsUsersCache.get(spaceId);
  if (cached && cached.expiresAt > now) return cached.userIds;
  if (cached) spaceWsUsersCache.delete(spaceId);
  const userIds = await redisCommandClient.smembers(getSpaceWsUsersKey(spaceId)).catch(() => [] as string[]);
  const normalized = userIds.map((value) => value.trim()).filter(Boolean);
  spaceWsUsersCache.set(spaceId, { expiresAt: now + SPACE_WS_USERS_CACHE_TTL_MS, userIds: normalized });
  return normalized;
};

async function fanOutBroadcastToLocalSockets(payload: GatewayWsBroadcastPayload) {
  const targetConnectionId = typeof payload.payload?.targetConnectionId === "string" ? payload.payload.targetConnectionId.trim() : "";
  const targetUserIds = Array.isArray(payload.payload?.targetUserIds)
    ? payload.payload.targetUserIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const resolvedUserIds = targetUserIds.length > 0
    ? targetUserIds
    : typeof payload.spaceId === "string" && payload.spaceId.trim()
      ? await getSpaceWsUsers(payload.spaceId)
      : [];
  const {
    targetUserIds: _targetUserIds,
    targetConnectionId: _targetConnectionId,
    ...cleanPayload
  } = (payload.payload ?? {}) as Record<string, unknown>;
  const envelope = { ...payload, payload: cleanPayload } as RealtimeEnvelope;

  if (targetConnectionId) {
    const socket = wsSockets.get(targetConnectionId);
    if (socket) sendWsRealtime(socket, wsConnections.get(targetConnectionId), envelope);
    return;
  }

  for (const userId of resolvedUserIds) {
    const connectionIds = wsConnectionsByUserId.get(userId);
    if (!connectionIds) continue;
    for (const connectionId of connectionIds) {
      const socket = wsSockets.get(connectionId);
      if (!socket) continue;
      sendWsRealtime(socket, wsConnections.get(connectionId), envelope);
    }
  }
}

async function startSpaceOutputSubscriber() {
  const client = createPubSubRedisClient();
  if (client.status === "wait") {
    await client.connect();
  }

  await client.subscribe(REALTIME_OUTBOUND_CHANNEL, AGENT_REALTIME_PATCH_CHANNEL);
  client.on("message", (channel, message) => {
    if (![REALTIME_OUTBOUND_CHANNEL, AGENT_REALTIME_PATCH_CHANNEL].includes(channel)) return;
    try {
      const parsed = realtimeEnvelopeSchema.safeParse(JSON.parse(message));
      if (!parsed.success) {
        logger.error("[Gateway] Invalid realtime payload:", parsed.error.issues);
        return;
      }
      void fanOutBroadcastToLocalSockets(parsed.data as GatewayWsBroadcastPayload).catch((error) => {
        logger.error("[Gateway] Failed to fan out realtime payload:", error);
      });
    } catch (error) {
      logger.error("[Gateway] Failed to handle realtime payload:", error);
    }
  });
}

const submitWebsocketSessionMessage = async (ctx: WsConnectionContext, requestId: string | undefined, payload: Record<string, unknown>) => {
  const spaceId = typeof payload.spaceId === "string" ? payload.spaceId.trim() : "";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  const clientMessageId = typeof payload.clientMessageId === "string" && payload.clientMessageId.trim()
    ? payload.clientMessageId.trim()
    : randomUUID();
  const content = Array.isArray(payload.content)
    ? payload.content as ContentBlock[]
    : [];
  const model = typeof payload.model === "string" && payload.model.trim()
    ? payload.model.trim()
    : null;
  const provider = typeof payload.provider === "string" && payload.provider.trim()
    ? payload.provider.trim()
    : null;

  if (!ctx.userId) throw new WsClientInputError("authentication required");
  if (!spaceId || !sessionId) throw new WsClientInputError("spaceId and sessionId are required");
  if (content.length === 0) throw new WsClientInputError("content is required");

  const effectiveRequestId = getOrCreateRequestId(requestId);
  const result = await submitInternalSessionPrompt({
    spaceId,
    sessionId,
    userId: ctx.userId,
    authToken: ctx.token,
    clientMessageId,
    content,
    source: "websocket",
    model,
    provider,
    context: {
      kind: "websocket",
      requestId: effectiveRequestId,
      connectionId: ctx.connectionId,
    },
  });

  return { ...result, spaceId, sessionId, clientMessageId, requestId: effectiveRequestId };
};

async function main() {
  logStartupInfo();

  await initOutboundConsumerGroup();
  startWsConnectionSweeper();
  await startSpaceOutputSubscriber();

  const reconcileRetryDelaysMs = [1_000, 3_000, 10_000, 30_000];
  let reconcileInFlight = false;
  let pendingReconcileReason: string | null = null;
  let lastChannelReconcileOk = false;
  let lastChannelReconcileAt: number | null = null;
  const sleep = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));
  const requestChannelReconcileOnce = async (reason: string) => {
    for (let attempt = 0; attempt <= reconcileRetryDelaysMs.length; attempt += 1) {
      try {
        const { stats } = await requestGatewayChannelReconcile();
        lastChannelReconcileOk = true;
        lastChannelReconcileAt = Date.now();
        logger.info("[Gateway] Channel reconcile requested", { reason, attempt: attempt + 1, stats });
        return true;
      } catch (error) {
        const retryDelayMs = reconcileRetryDelaysMs[attempt];
        if (retryDelayMs == null) {
          lastChannelReconcileOk = false;
          lastChannelReconcileAt = Date.now();
          logger.error("[Gateway] Failed to request channel reconcile", { reason, attempt: attempt + 1, error });
          return false;
        }
        logger.warn("[Gateway] Failed to request channel reconcile; retrying", { reason, attempt: attempt + 1, retryDelayMs, error });
        await sleep(retryDelayMs);
      }
    }
    return false;
  };

  const requestChannelReconcile = async (reason: string) => {
    if (reconcileInFlight) {
      pendingReconcileReason = pendingReconcileReason ? `${pendingReconcileReason},${reason}` : reason;
      return false;
    }

    reconcileInFlight = true;
    let currentReason = reason;
    let lastResult = false;
    try {
      while (true) {
        lastResult = await requestChannelReconcileOnce(currentReason);
        if (!pendingReconcileReason) break;
        currentReason = pendingReconcileReason;
        pendingReconcileReason = null;
      }
      return lastResult;
    } finally {
      reconcileInFlight = false;
    }
  };

  const manager = new GatewayManager({
    onStaleNodesPruned: (nodeIds) => requestChannelReconcile(`stale_nodes_pruned:${nodeIds.join(",")}`),
  });
  await manager.start();
  void requestChannelReconcile("node_started");

  logger.info("[Gateway] Listening for outbound commands from API...");

  listenOutboundCommands(async (cmd: PlannedGatewayOutboundCommand) => {
    logger.info("[Gateway] Received outbound command:", {
      commandId: cmd.commandId,
      channelId: cmd.channelId,
      provider: cmd.provider,
      externalChatId: cmd.externalChatId,
      contentPreview: cmd.content.map((c: { type: string }) => c.type).join(", "),
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
        const ctx = wsConnections.get(targetConnectionId);
        const { targetUserIds: _targetUserIds, targetConnectionId: _targetConnectionId, ...cleanPayload } = envelope.payload as Record<string, unknown>;
        sendWsRealtime(socket, ctx, { ...envelope, payload: cleanPayload });
        return { success: true, externalMessageId: targetConnectionId };
      }

      let delivered = 0;
      for (const userId of targetUserIds) {
        const connectionIds = wsConnectionsByUserId.get(userId);
        if (!connectionIds) continue;
        for (const connectionId of connectionIds) {
          const socket = wsSockets.get(connectionId);
          if (!socket) continue;
          const ctx = wsConnections.get(connectionId);
          const { targetUserIds: _targetUserIds, targetConnectionId: _targetConnectionId, ...cleanPayload } = envelope.payload as Record<string, unknown>;
          sendWsRealtime(socket, ctx, { ...envelope, payload: cleanPayload });
          delivered += 1;
        }
      }

      return { success: true, externalMessageId: String(delivered) };
    }

    const provider = manager.getProvider(cmd.channelId);
    if (!provider) {
      logger.warn(`[Gateway] Command rejected: provider not found for channel ${cmd.channelId}`);
      logger.warn(`[Gateway] Active channels: ${manager.getActiveChannelIds().join(", ") || "none"}`);
      return { success: false, error: `Provider not found for channel ${cmd.channelId}` };
    }

    logger.info(`[Gateway] Routing command ${cmd.commandId} to ${cmd.provider} provider`);
    const result = await provider.handleOutbound(cmd);
    logger.info(`[Gateway] Command ${cmd.commandId} result:`, result.success ? "success" : `failed: ${result.error}`);
    return result;
  }).catch((error) => {
    logger.error("[Gateway] Fatal error listening to outbound stream:", error);
  });

  const app = new Hono();
  app.use(
    "*",
    httpInstrumentationMiddleware({
      serviceName: "cohub-gateway",
    }),
  );
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
    return c.json({
      ready: Object.values(checks).every(Boolean),
      checks,
      channelReconcile: {
        ok: lastChannelReconcileOk,
        inFlight: reconcileInFlight,
        pendingReason: pendingReconcileReason,
        checkedAt: lastChannelReconcileAt,
      },
    }, Object.values(checks).every(Boolean) ? 200 : 503);
  });

  const server = serve({ fetch: app.fetch, port: gatewayConfig.port }) as unknown as import("node:http").Server;
  const wss = new WebSocketServer({ noServer: true });
  const asrWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  const websocketRoutes = new Map<string, WebSocketServer>([
    ["/ws", wss],
    ["/asr/ws", asrWss],
  ]);

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, "http://localhost").pathname : "";
    const websocketServer = websocketRoutes.get(pathname);

    if (!websocketServer) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  asrWss.on("connection", handleAsrWebSocketConnection);

  wss.on("connection", (socket: WebSocket) => {
    const connectionId = randomUUID();
    const ctx: WsConnectionContext = {
      connectionId,
      capabilities: new Set(),
      compactStreamAliases: new Map(),
      nextCompactStreamAlias: 0,
    };
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
          ctx.capabilities = new Set(
            Array.isArray(message.payload.capabilities)
              ? message.payload.capabilities.filter((value) => typeof value === "string" && value.trim())
              : [],
          );
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

        if (message.type === "canvas.tx") {
          try {
            const payload = message.payload ?? {};
            const spaceId = typeof payload.spaceId === "string" ? payload.spaceId : "";
            const documentId = typeof payload.documentId === "string" ? payload.documentId : "";
            const txId = typeof payload.txId === "string" ? payload.txId : "";
            const ops = Array.isArray(payload.ops) ? payload.ops.filter((op): op is Record<string, unknown> => Boolean(op && typeof op === "object" && !Array.isArray(op))) : [];
            if (!spaceId || !documentId || !txId || ops.length === 0) throw new WsClientInputError("invalid canvas transaction");
            const result = await submitCanvasTransaction({
              userId: ctx.userId,
              spaceId,
              documentId,
              txId,
              baseVersion: typeof payload.baseVersion === "number" ? payload.baseVersion : null,
              clientId: typeof payload.clientId === "string" ? payload.clientId : null,
              undoGroupId: typeof payload.undoGroupId === "string" ? payload.undoGroupId : null,
              ops,
            });
            sendWsEnvelope(socket, buildRealtimeEnvelope({
              domain: "space",
              type: "canvas.tx.ack",
              requestId: requestId ?? null,
              spaceId,
              sessionId: null,
              payload: { documentId, txId, version: result.document.version },
            }));
          } catch (error) {
            if (error instanceof WsClientInputError) throw error;
            const payload = message.payload ?? {};
            sendWsEnvelope(socket, buildRealtimeEnvelope({
              domain: "space",
              type: "canvas.tx.error",
              requestId: requestId ?? null,
              spaceId: typeof payload.spaceId === "string" ? payload.spaceId : null,
              sessionId: null,
              payload: {
                documentId: typeof payload.documentId === "string" ? payload.documentId : null,
                txId: typeof payload.txId === "string" ? payload.txId : null,
                message: error instanceof Error ? error.message : String(error),
              },
            }));
          }
          return;
        }

        if (message.type === "session.message.create") {
          try {
            const result = await submitWebsocketSessionMessage(ctx, requestId, message.payload ?? {});
            sendWsEnvelope(socket, buildRealtimeEnvelope({
              domain: "session",
              type: "session.request.accepted",
              requestId: result.requestId,
              spaceId: result.spaceId,
              sessionId: result.sessionId,
              payload: {
                clientMessageId: result.clientMessageId,
                turnId: result.turnId,
                userMessageId: result.userMessageId,
                traceId: result.trace.traceId,
              },
            }));
          } catch (error) {
            if (error instanceof WsClientInputError) throw error;
            const payload = message.payload ?? {};
            sendWsEnvelope(socket, buildRealtimeEnvelope({
              domain: "session",
              type: "session.request.error",
              requestId: requestId ?? null,
              spaceId: typeof payload.spaceId === "string" ? payload.spaceId : null,
              sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
              payload: {
                code: "SUBMIT_FAILED",
                message: error instanceof Error ? error.message : String(error),
                clientMessageId: typeof payload.clientMessageId === "string" ? payload.clientMessageId : null,
              },
            }));
          }
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
        logger.error("[Gateway] WebSocket message handling failed:", error);
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

  logger.info(`@cohub/gateway listening on :${gatewayConfig.port}`);

  const shutdown = async () => {
    logger.info("[Gateway] Received shutdown signal, stopping...");
    await manager.stop();
    logger.info("[Gateway] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  if (process.env.DEBUG_MODE === "true") {
    logger.info("[Gateway] DEBUG_MODE enabled.");

    const startDebugProvider = async (channelId: string, providerType: string, credential: string | { appId: string; appSecret: string; brand?: string }) => {
      logger.info(`[Debug] Initializing test channel: ${channelId} (${providerType})`);

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

  }
}

main().catch((error) => logger.error("[Gateway] main failed", error));
