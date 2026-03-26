import { db } from "./db/index.js";
import { gatewayLogs, providerMessageRefs } from "./db/schema.js";
import { createBlockingRedisClient } from "./redis.js";
import type { GatewayLogEvent, GatewayOutboundCommand } from "@cohub/protocol";

const LOG_STREAM = "stream:gateway:logs";

/**
 * 启动 Gateway 日志消费者，将日志写入数据库
 */
export const startGatewayLogConsumer = async () => {
  console.log("[GatewayLogs] Consumer started");
  let lastId = "$";
  const client = createBlockingRedisClient();

  await client.connect().catch(() => undefined);

  while (true) {
    try {
      const result = await client.xread("BLOCK", 0, "STREAMS", LOG_STREAM, lastId);
      if (!result) continue;

      for (const [stream, messages] of result) {
        for (const [id, fields] of messages) {
          lastId = id;
          const payloadIndex = fields.findIndex((f) => f === "payload");
          const payloadStr = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;
          if (!payloadStr) continue;

          const event = JSON.parse(payloadStr) as GatewayLogEvent;
          await persistLogEvent(event).catch((err) => {
            console.error("[GatewayLogs] Failed to persist log event:", err);
          });
        }
      }
    } catch (error) {
      console.error("[GatewayLogs] Redis XREAD error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
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
  if (!rawPayload.runtimeId || !rawPayload.runtimeSessionId) return;

  await db
    .insert(providerMessageRefs)
    .values({
      provider: event.provider,
      runtimeId: rawPayload.runtimeId,
      runtimeSessionId: rawPayload.runtimeSessionId,
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
        runtimeId: rawPayload.runtimeId,
        runtimeSessionId: rawPayload.runtimeSessionId,
        runtimeChannelId: event.channelId,
        sessionMessageId: rawPayload.sessionMessageId ?? null,
        meta: {
          commandId: rawPayload.commandId ?? event.correlationId ?? null,
          replyToExternalMessageId: rawPayload.replyToExternalMessageId ?? null,
          gatewayLogId: event.logId,
          providerMeta: rawPayload.meta ?? null,
        },
        updatedAt: new Date(),
      },
    });
};
