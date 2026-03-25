import { db } from "./db/index.js";
import { gatewayLogs } from "./db/schema.js";
import { createBlockingRedisClient } from "./redis.js";
import type { GatewayLogEvent } from "@cohub/protocol";

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
};
