import { db } from "./db/index.js";
import { gatewayLogs, providerMessageRefs } from "./db/schema.js";
import { createBlockingRedisClient, redisCommandClient, ensureConsumerGroup, GATEWAY_LOGS_STREAM, LOG_CONSUMER_GROUP } from "./redis.js";
import type { GatewayLogEvent, GatewayOutboundCommand } from "@cohub/protocol";

const LOG_STREAM = GATEWAY_LOGS_STREAM;
const GROUP_NAME = LOG_CONSUMER_GROUP;
const CONSUMER_NAME = `api-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 5000;

let isRunning = false;
let consumerClient: ReturnType<typeof createBlockingRedisClient> | null = null;

export const initLogConsumerGroup = async () => {
  await ensureConsumerGroup(LOG_STREAM, GROUP_NAME, "0");
  console.log("[GatewayLogs] Consumer group ready:", GROUP_NAME);
};

export const stopLogConsumer = async () => {
  isRunning = false;
  if (consumerClient) {
    await consumerClient.quit().catch(() => {});
    consumerClient = null;
  }
};

export const startGatewayLogConsumer = async () => {
  if (isRunning) return;
  isRunning = true;

  consumerClient = createBlockingRedisClient();
  if (consumerClient.status === "wait") {
    await consumerClient.connect();
  }

  console.log("[GatewayLogs] Consumer started", { group: GROUP_NAME, consumer: CONSUMER_NAME });

  while (isRunning) {
    try {
      const result = await consumerClient.xreadgroup(
        "GROUP", GROUP_NAME, CONSUMER_NAME,
        "COUNT", BATCH_SIZE,
        "BLOCK", BLOCK_MS,
        "STREAMS", LOG_STREAM, ">"
      );

      if (!result) continue;

      for (const [, messages] of result as Array<[string, Array<[string, string[]]>]>) {
        for (const [id, fields] of messages) {
          const payload = fields[fields.indexOf("payload") + 1];
          if (!payload) {
            await redisCommandClient.xack(LOG_STREAM, GROUP_NAME, id);
            continue;
          }

          try {
            await persistLogEvent(JSON.parse(payload) as GatewayLogEvent);
            await redisCommandClient.xack(LOG_STREAM, GROUP_NAME, id);
          } catch (err) {
            console.error(`[GatewayLogs] Failed ${id}:`, err);
            // 不 ACK，消息会重试
          }
        }
      }
    } catch (error) {
      if (!isRunning) break;
      console.error("[GatewayLogs] Error:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
};

export const checkPendingMessages = async () => {
  const pending = await redisCommandClient.xpending(LOG_STREAM, GROUP_NAME);
  if (!pending || pending[0] === 0) {
    return { total: 0 };
  }
  return { total: Number(pending[0]) };
};

/**
 * 将日志事件写入数据库
 */
const persistLogEvent = async (event: GatewayLogEvent) => {
  await db.insert(gatewayLogs).values({
    id: event.logId,
    direction: event.direction,
    provider: event.provider,
    channelId: event.channelId,
    externalChatId: event.externalChatId,
    rawPayload: event.rawPayload,
    normalizedPayload: event.normalizedPayload ?? null,
    status: event.status,
    errorMessage: event.errorMessage ?? null,
    createdAt: new Date(event.timestamp),
  });

  if (event.direction !== "outbound" || !event.externalMessageId) return;

  const rawPayload = event.rawPayload as Partial<GatewayOutboundCommand>;
  if (!rawPayload.spaceId || !rawPayload.spaceSessionId) return;

  await db
    .insert(providerMessageRefs)
    .values({
      provider: event.provider,
      runtimeId: rawPayload.spaceId,
      runtimeSessionId: rawPayload.spaceSessionId,
      runtimeChannelId: event.channelId,
      sessionMessageId: rawPayload.sessionMessageId ?? null,
      direction: "outbound",
      externalConversationId: event.externalChatId,
      externalMessageId: event.externalMessageId,
      externalAuthorId: null,
      externalAuthorName: null,
      meta: {
        commandId: rawPayload.commandId ?? event.correlationId ?? null,
        replyToExternalMessageId: rawPayload.replyToExternalMessageId ?? null,
        gatewayLogId: event.logId,
        providerMeta: rawPayload.meta ?? null,
        kind:
          (rawPayload.meta as Record<string, unknown> | null)?.renderMode === "rich_status"
            ? "primary_display"
            : ((rawPayload.meta as Record<string, unknown> | null)?.source === "session_persist"
                ? "primary_display"
                : "outbound_message"),
        anchorUserMessageId:
          typeof (rawPayload.meta as Record<string, unknown> | null)?.turnAnchorMessageId === "string"
            ? (rawPayload.meta as Record<string, unknown>).turnAnchorMessageId
            : null,
      },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        providerMessageRefs.provider,
        providerMessageRefs.externalConversationId,
        providerMessageRefs.externalMessageId,
        providerMessageRefs.direction,
      ],
      set: {
        runtimeId: rawPayload.spaceId,
        runtimeSessionId: rawPayload.spaceSessionId,
        runtimeChannelId: event.channelId,
        sessionMessageId: rawPayload.sessionMessageId ?? null,
        meta: {
          commandId: rawPayload.commandId ?? event.correlationId ?? null,
          replyToExternalMessageId: rawPayload.replyToExternalMessageId ?? null,
          gatewayLogId: event.logId,
          providerMeta: rawPayload.meta ?? null,
          kind:
            (rawPayload.meta as Record<string, unknown> | null)?.renderMode === "rich_status"
              ? "primary_display"
              : ((rawPayload.meta as Record<string, unknown> | null)?.source === "session_persist"
                  ? "primary_display"
                  : "outbound_message"),
          anchorUserMessageId:
            typeof (rawPayload.meta as Record<string, unknown> | null)?.turnAnchorMessageId === "string"
              ? (rawPayload.meta as Record<string, unknown>).turnAnchorMessageId
              : null,
        },
        updatedAt: new Date(),
      },
    });
};
