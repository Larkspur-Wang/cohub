import { createLogger } from "@cohub/infra/logging";
import { randomUUID } from "node:crypto";
import type { GatewayConversationCreateEvent, GatewayInboundEvent } from "@cohub/protocol/gateway";
import type { PlannedGatewayOutboundCommand } from "@cohub/protocol/gateway";
import { buildTraceHeaders } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import {
  createBlockingRedisClient,
  type RedisStreamEntry,
  redisCommandClient,
  getGatewayNodeOutboundStreamKey,
  STREAM_APPROX,
  STREAM_MAXLEN,
} from "./redis.js";
import { gatewayConfig } from "./config.js";
import { touchChannelInbound } from "./channel-health.js";


const logger = createLogger({ serviceName: "cohub-gateway" });
const ensureConsumerGroup = async (streamKey: string, groupName: string) => {
  try {
    await redisCommandClient.xgroup("CREATE", streamKey, groupName, "0", "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) throw err;
  }
};

export const getOutboundStreamForNode = getGatewayNodeOutboundStreamKey;

// Inbound event dedup — prevents duplicate processing on WS reconnects
const inboundDedup = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 10000;

const buildInboundDedupKey = (event: GatewayInboundEvent) => {
  const provider = event.provider?.trim();
  const chatId = event.externalChatId?.trim();
  const messageId = event.externalMessageId?.trim();
  if (provider && chatId && messageId) return `${provider}:${chatId}:${messageId}`;
  return event.eventId;
};

export const publishInboundEvent = async (event: GatewayInboundEvent) => {
  const dedupKey = buildInboundDedupKey(event);

  // Dedup: skip if already processed (handles WS reconnect duplicate delivery)
  if (inboundDedup.has(dedupKey)) {
    logger.info(`[Bus] Duplicate inbound event ${dedupKey}, skipping`);
    return;
  }

  // Periodic cleanup
  if (inboundDedup.size > DEDUP_MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, ts] of inboundDedup) {
      if (now - ts > DEDUP_TTL_MS) inboundDedup.delete(id);
    }
  }

  // Inject trace context so downstream services (API → Agent) can continue the same trace
  const traceCarrier = injectTrace();
  const enrichedEvent = Object.keys(traceCarrier).length > 0 ? { ...event, ...traceCarrier } : event;

  const response = await fetch(`${gatewayConfig.apiBaseUrl}/internal/gateway/inbound`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-secret": gatewayConfig.workerSecret,
      ...buildTraceHeaders({ requestId: event.eventId }),
    },
    body: JSON.stringify(enrichedEvent),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gateway inbound submit failed ${response.status}: ${text}`);
  }
  inboundDedup.set(dedupKey, Date.now());
  if (event.channelId) {
    void touchChannelInbound(event.channelId).catch(() => undefined);
  }

  logger.info(`[Bus] Inbound submitted: ${event.eventId.slice(0, 8)}`);
};

export const publishConversationCreateEvent = async (
  input: Omit<GatewayConversationCreateEvent, "eventId" | "timestamp" | "eventType" | "content" | "sender" | "command"> & { sender?: GatewayConversationCreateEvent["sender"] }
) => {
  await publishInboundEvent({
    eventId: randomUUID(),
    timestamp: Date.now(),
    eventType: "conversation_create",
    sender: input.sender ?? { id: "system", name: "system" },
    content: [],
    ...input,
  });
};

const OUTBOUND_CONSUMER_GROUP = "gateway-outbound-consumers";
const OUTBOUND_BATCH_SIZE = 10;
const OUTBOUND_BLOCK_MS = 5000;
const PENDING_CLAIM_MIN_IDLE_MS = 30_000;
const OUTBOUND_COMMAND_DONE_TTL_SECONDS = 24 * 60 * 60;
const OUTBOUND_COMMAND_LOCK_TTL_SECONDS = 60;
const MAX_OUTBOUND_DELIVERY_ATTEMPTS = 3;

export const initOutboundConsumerGroup = async (nodeId: string) => {
  const streamKey = getGatewayNodeOutboundStreamKey(nodeId);
  await ensureConsumerGroup(streamKey, OUTBOUND_CONSUMER_GROUP);
  logger.info("[Bus] Outbound consumer group ready", { group: OUTBOUND_CONSUMER_GROUP, streamKey });
};

type ClaimedPendingResult = {
  nextStartId: string;
  messages: RedisStreamEntry[];
};

const parseClaimedPending = (value: unknown): ClaimedPendingResult => {
  if (!Array.isArray(value)) return { nextStartId: "0-0", messages: [] };
  const nextStartId = typeof value[0] === "string" ? value[0] : "0-0";
  const messages = Array.isArray(value[1]) ? value[1] as RedisStreamEntry[] : [];
  return { nextStartId, messages };
};

const ackAndDelete = async (streamKey: string, id: string) => {
  await redisCommandClient.xack(streamKey, OUTBOUND_CONSUMER_GROUP, id);
  await redisCommandClient.xdel(streamKey, id).catch(() => undefined);
};

const getCommandAttempts = (cmd: PlannedGatewayOutboundCommand) => {
  const value = cmd.meta?.deliveryAttempt;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
};

const requeueCommand = async (streamKey: string, cmd: PlannedGatewayOutboundCommand, error: string) => {
  const nextAttempt = getCommandAttempts(cmd) + 1;
  if (nextAttempt >= MAX_OUTBOUND_DELIVERY_ATTEMPTS) {
    logger.error("[Bus] Outbound command exhausted retries", {
      commandId: cmd.commandId,
      channelId: cmd.channelId,
      attempts: nextAttempt,
      error,
    });
    return false;
  }

  const retryCommand: PlannedGatewayOutboundCommand = {
    ...cmd,
    meta: {
      ...(cmd.meta ?? {}),
      deliveryAttempt: nextAttempt,
      lastDeliveryError: error,
      retriedAt: Date.now(),
    },
  };
  await redisCommandClient.xadd(streamKey, "MAXLEN", STREAM_APPROX, STREAM_MAXLEN, "*", "payload", JSON.stringify(retryCommand));
  logger.warn("[Bus] Requeued outbound command", {
    commandId: cmd.commandId,
    channelId: cmd.channelId,
    attempt: nextAttempt,
    error,
  });
  return true;
};

const acquireCommandLock = async (cmd: PlannedGatewayOutboundCommand) => {
  const doneKey = `gateway:outbound:done:${cmd.commandId}`;
  if (await redisCommandClient.exists(doneKey)) return { acquired: false, done: true, lockKey: null, token: null } as const;

  const lockKey = `gateway:outbound:lock:${cmd.commandId}`;
  const token = randomUUID();
  const locked = await redisCommandClient.set(lockKey, token, "EX", OUTBOUND_COMMAND_LOCK_TTL_SECONDS, "NX");
  return locked === "OK"
    ? { acquired: true, done: false, lockKey, token } as const
    : { acquired: false, done: false, lockKey, token: null } as const;
};

const releaseCommandLock = async (lockKey: string | null, token: string | null) => {
  if (!lockKey || !token) return;
  const current = await redisCommandClient.get(lockKey).catch(() => null);
  if (current === token) await redisCommandClient.del(lockKey).catch(() => undefined);
};

const markCommandDone = async (cmd: PlannedGatewayOutboundCommand) => {
  await redisCommandClient.set(`gateway:outbound:done:${cmd.commandId}`, "1", "EX", OUTBOUND_COMMAND_DONE_TTL_SECONDS);
};

const processOutboundEntry = async (
  streamKey: string,
  id: string,
  fields: string[],
  onCommand: (cmd: PlannedGatewayOutboundCommand) => Promise<{ success: boolean; error?: string; externalMessageId?: string }>,
) => {
  const payload = fields[fields.indexOf("payload") + 1];
  if (!payload) {
    await ackAndDelete(streamKey, id);
    return;
  }

  let cmd: PlannedGatewayOutboundCommand;
  try {
    cmd = JSON.parse(payload) as PlannedGatewayOutboundCommand;
  } catch (error) {
    logger.error("[Bus] Dropping invalid outbound command payload", { streamId: id, error });
    await ackAndDelete(streamKey, id);
    return;
  }

  const lock = await acquireCommandLock(cmd);
  if (lock.done) {
    logger.info("[Bus] Dropping already completed duplicate outbound command", { streamId: id, commandId: cmd.commandId });
    await ackAndDelete(streamKey, id);
    return;
  }
  if (!lock.acquired) {
    logger.warn("[Bus] Outbound command is already being processed; leaving pending", { streamId: id, commandId: cmd.commandId });
    return;
  }

  try {
    logger.info("[Bus] Consuming outbound command", {
      streamId: id,
      commandId: cmd.commandId,
      channelId: cmd.channelId,
      provider: cmd.provider,
      externalChatId: cmd.externalChatId,
      replyToExternalMessageId: cmd.replyToExternalMessageId ?? null,
      attempt: getCommandAttempts(cmd),
    });
    const result = await onCommand(cmd);
    if (result.success) {
      await markCommandDone(cmd);
      await ackAndDelete(streamKey, id);
      logger.info("[Bus] Acked outbound command", {
        streamId: id,
        commandId: cmd.commandId,
        success: true,
        externalMessageId: result.externalMessageId ?? null,
      });
      return;
    }

    await requeueCommand(streamKey, cmd, result.error ?? "outbound command failed");
    await ackAndDelete(streamKey, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Bus] Failed ${id}:`, error);
    await requeueCommand(streamKey, cmd, message);
    await ackAndDelete(streamKey, id);
  } finally {
    await releaseCommandLock(lock.lockKey, lock.token);
  }
};

export const listenOutboundCommands = async (
  nodeId: string,
  onCommand: (cmd: PlannedGatewayOutboundCommand) => Promise<{ success: boolean; error?: string; externalMessageId?: string }>
) => {
  const streamKey = getGatewayNodeOutboundStreamKey(nodeId);
  const consumerName = `gateway-${nodeId}`;
  logger.info(`[Bus] Listening: ${streamKey}`);

  const client = createBlockingRedisClient();
  logger.info("[Bus] Outbound redis client status before connect:", client.status);
  if (client.status === "wait") {
    await client.connect();
  }
  logger.info("[Bus] Outbound redis client status after connect:", client.status);

  let reclaimPending = true;
  let reclaimStartId = "0-0";
  let lastPendingReclaimAt = 0;

  while (true) {
    try {
      if (!reclaimPending && Date.now() - lastPendingReclaimAt >= PENDING_CLAIM_MIN_IDLE_MS) {
        reclaimPending = true;
        reclaimStartId = "0-0";
      }
      const claimed = reclaimPending
        ? parseClaimedPending(await client.xautoclaim(
            streamKey,
            OUTBOUND_CONSUMER_GROUP,
            consumerName,
            PENDING_CLAIM_MIN_IDLE_MS,
            reclaimStartId,
            "COUNT",
            OUTBOUND_BATCH_SIZE,
          ))
        : null;
      const result = claimed
        ? (claimed.messages.length > 0 ? [[streamKey, claimed.messages]] as Array<[string, RedisStreamEntry[]]> : null)
        : await client.xreadgroup(
            "GROUP", OUTBOUND_CONSUMER_GROUP, consumerName,
            "COUNT", OUTBOUND_BATCH_SIZE,
            "BLOCK", OUTBOUND_BLOCK_MS,
            "STREAMS", streamKey, ">",
          ) as Array<[string, RedisStreamEntry[]]> | null;

      if (claimed) {
        lastPendingReclaimAt = Date.now();
        reclaimStartId = claimed.nextStartId;
        if (claimed.nextStartId === "0-0") reclaimPending = false;
      }

      if (!result) {
        reclaimPending = false;
        continue;
      }

      for (const [, messages] of result) {
        for (const [id, fields] of messages) {
          await processOutboundEntry(streamKey, id, fields, onCommand);
        }
      }
    } catch (error) {
      logger.error("[Bus] Error:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};
