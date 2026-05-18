import { randomUUID } from "node:crypto";
import type { GatewayConversationCreateEvent, GatewayInboundEvent } from "@cohub/protocol/gateway";
import type { PlannedGatewayOutboundCommand } from "@cohub/protocol/gateway";
import { buildTraceHeaders } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import {
  createBlockingRedisClient,
  type RedisStreamEntry,
  redisCommandClient,
  GATEWAY_OUTBOUND_STREAM,
} from "./redis.js";
import { gatewayConfig } from "./config.js";

const ensureConsumerGroup = async (streamKey: string, groupName: string) => {
  try {
    await redisCommandClient.xgroup("CREATE", streamKey, groupName, "0", "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) throw err;
  }
};

export const OUTBOUND_STREAM = GATEWAY_OUTBOUND_STREAM;

console.log(`[Bus] Stream names: outbound=${OUTBOUND_STREAM}`);

// Inbound event dedup — prevents duplicate processing on WS reconnects
const inboundDedup = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 10000;

export const publishInboundEvent = async (event: GatewayInboundEvent) => {
  // Dedup: skip if already processed (handles WS reconnect duplicate delivery)
  if (inboundDedup.has(event.eventId)) {
    console.log(`[Bus] Duplicate inbound event ${event.eventId.slice(0, 8)}, skipping`);
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
  inboundDedup.set(event.eventId, Date.now());

  console.log(`[Bus] Inbound submitted: ${event.eventId.slice(0, 8)}`);
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

// Consumer Group 配置
const OUTBOUND_CONSUMER_GROUP = "gateway-outbound-consumers";
const OUTBOUND_CONSUMER_NAME = `gateway-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const OUTBOUND_BATCH_SIZE = 10;
const OUTBOUND_BLOCK_MS = 5000;

export const initOutboundConsumerGroup = async () => {
  await ensureConsumerGroup(OUTBOUND_STREAM, OUTBOUND_CONSUMER_GROUP);
  console.log("[Bus] Outbound consumer group ready:", OUTBOUND_CONSUMER_GROUP);
};



export const listenOutboundCommands = async (
  onCommand: (cmd: PlannedGatewayOutboundCommand) => Promise<{ success: boolean; error?: string; externalMessageId?: string }>
) => {
  console.log(`[Bus] Listening: ${OUTBOUND_STREAM}`);

  const client = createBlockingRedisClient();
  console.log("[Bus] Outbound redis client status before connect:", client.status);
  if (client.status === "wait") {
    await client.connect();
  }
  console.log("[Bus] Outbound redis client status after connect:", client.status);

  while (true) {
    try {
      const result = await client.xreadgroup(
        "GROUP", OUTBOUND_CONSUMER_GROUP, OUTBOUND_CONSUMER_NAME,
        "COUNT", OUTBOUND_BATCH_SIZE,
        "BLOCK", OUTBOUND_BLOCK_MS,
        "STREAMS", OUTBOUND_STREAM, ">"
      );

      if (!result) continue;

      for (const [, messages] of result as Array<[string, RedisStreamEntry[]]>) {
        for (const [id, fields] of messages) {
          const payload = fields[fields.indexOf("payload") + 1];
          if (!payload) {
            await redisCommandClient.xack(OUTBOUND_STREAM, OUTBOUND_CONSUMER_GROUP, id);
            continue;
          }

          try {
            // at-most-once: 处理失败也 ACK，避免坏消息阻塞整条队列
            const cmd = JSON.parse(payload) as PlannedGatewayOutboundCommand;
            console.log("[Bus] Consuming outbound command", {
              streamId: id,
              commandId: cmd.commandId,
              channelId: cmd.channelId,
              provider: cmd.provider,
              externalChatId: cmd.externalChatId,
              replyToExternalMessageId: cmd.replyToExternalMessageId ?? null,
            });
            const result = await onCommand(cmd);
            await redisCommandClient.xack(OUTBOUND_STREAM, OUTBOUND_CONSUMER_GROUP, id);
            console.log("[Bus] Acked outbound command", {
              streamId: id,
              commandId: cmd.commandId,
              success: result.success,
              externalMessageId: result.externalMessageId ?? null,
              error: result.error ?? null,
            });
          } catch (err) {
            console.error(`[Bus] Failed ${id}:`, err);
            await redisCommandClient.xack(OUTBOUND_STREAM, OUTBOUND_CONSUMER_GROUP, id);
          }
        }
      }
    } catch (error) {
      console.error("[Bus] Error:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};
