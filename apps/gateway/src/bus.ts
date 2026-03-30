import { randomUUID } from "node:crypto";
import type { GatewayInboundEvent, GatewayOutboundCommand, GatewayLogEvent } from "@cohub/protocol";
import {
  createBlockingRedisClient,
  type RedisStreamEntry,
  redisCommandClient,
  xaddWithMaxlen,
  GATEWAY_INBOUND_STREAM,
  GATEWAY_OUTBOUND_STREAM,
  GATEWAY_LOGS_STREAM,
} from "./redis.js";

const ensureConsumerGroup = async (streamKey: string, groupName: string) => {
  try {
    await redisCommandClient.xgroup("CREATE", streamKey, groupName, "0", "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) throw err;
  }
};

export const INBOUND_STREAM = GATEWAY_INBOUND_STREAM;
export const OUTBOUND_STREAM = GATEWAY_OUTBOUND_STREAM;
export const LOG_STREAM = GATEWAY_LOGS_STREAM;

console.log(`[Bus] Stream names: inbound=${INBOUND_STREAM}, outbound=${OUTBOUND_STREAM}, logs=${LOG_STREAM}`);

const publishLogEvent = async (event: GatewayLogEvent) => {
  await xaddWithMaxlen(redisCommandClient, LOG_STREAM, "*", "payload", JSON.stringify(event));
};

export const publishInboundEvent = async (event: GatewayInboundEvent) => {
  const logEvent: GatewayLogEvent = {
    logId: randomUUID(),
    timestamp: Date.now(),
    direction: "inbound",
    provider: event.provider,
    channelId: event.channelId,
    externalChatId: event.externalChatId,
    externalMessageId: event.externalMessageId,
    rawPayload: event as unknown as Record<string, unknown>,
    status: "success",
    correlationId: event.eventId,
  };

  await Promise.all([
    xaddWithMaxlen(redisCommandClient, INBOUND_STREAM, "*", "payload", JSON.stringify(event)),
    publishLogEvent(logEvent),
  ]);

  console.log(`[Bus] Inbound: ${event.eventId.slice(0, 8)}`);
};

export const publishConversationCreateEvent = async (
  input: Omit<GatewayInboundEvent, "eventId" | "timestamp" | "content" | "sender"> & { sender?: GatewayInboundEvent["sender"] }
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

export const publishOutboundLog = async (input: {
  cmd: GatewayOutboundCommand;
  result: { success: boolean; error?: string; externalMessageId?: string };
}) => {
  await publishLogEvent({
    logId: randomUUID(),
    timestamp: Date.now(),
    direction: "outbound",
    provider: input.cmd.provider,
    channelId: input.cmd.channelId,
    externalChatId: input.cmd.externalChatId,
    externalMessageId: input.result.externalMessageId,
    rawPayload: input.cmd as unknown as Record<string, unknown>,
    status: input.result.success ? "success" : "failed",
    errorMessage: input.result.error,
    correlationId: input.cmd.commandId,
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
  onCommand: (cmd: GatewayOutboundCommand) => Promise<{ success: boolean; error?: string; externalMessageId?: string }>
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
            const cmd = JSON.parse(payload) as GatewayOutboundCommand;
            console.log("[Bus] Consuming outbound command", {
              streamId: id,
              commandId: cmd.commandId,
              channelId: cmd.channelId,
              provider: cmd.provider,
              externalChatId: cmd.externalChatId,
              replyToExternalMessageId: cmd.replyToExternalMessageId ?? null,
            });
            const result = await onCommand(cmd);
            await publishOutboundLog({ cmd, result });
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
