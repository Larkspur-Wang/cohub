import { db } from "./db/index.js";
import { gatewayLogs, providerMessageRefs } from "./db/schema.js";
import { createBlockingRedisClient, redisCommandClient } from "./redis.js";
import type { GatewayLogEvent, GatewayOutboundCommand } from "@cohub/protocol";

const LOG_STREAM = "stream:gateway:logs";
const GROUP_NAME = "api-loggers";
const CONSUMER_NAME = `api-${process.env.POD_NAME || process.env.HOSTNAME || Math.random().toString(36).slice(2, 8)}`;
const BATCH_SIZE = 100;
const BLOCK_MS = 5000;

let isRunning = false;
let consumerClient: ReturnType<typeof createBlockingRedisClient> | null = null;

/**
 * 初始化消费者组（幂等操作）
 */
export const initLogConsumerGroup = async () => {
  try {
    // MKSTREAM 表示 Stream 不存在时自动创建
    // 从 0 开始消费，确保不遗漏历史消息
    await redisCommandClient.xgroup("CREATE", LOG_STREAM, GROUP_NAME, "0", "MKSTREAM");
    console.log("[GatewayLogs] Consumer group created:", GROUP_NAME);
  } catch (err) {
    // 组已存在是正常的（ioredis 会抛出错误）
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("already exists")) {
      console.log("[GatewayLogs] Consumer group already exists:", GROUP_NAME);
    } else {
      throw err;
    }
  }
};

/**
 * 停止日志消费者
 */
export const stopLogConsumer = async () => {
  isRunning = false;
  if (consumerClient) {
    try {
      await consumerClient.quit();
    } catch {
      try {
        consumerClient.disconnect();
      } catch {
        // ignore
      }
    }
    consumerClient = null;
  }
  console.log("[GatewayLogs] Consumer stopped");
};

/**
 * 启动 Gateway 日志消费者，将日志写入数据库
 * 使用消费者组模式，支持多实例负载均衡和故障转移
 */
export const startGatewayLogConsumer = async () => {
  if (isRunning) {
    console.log("[GatewayLogs] Consumer already running");
    return;
  }

  isRunning = true;
  console.log("[GatewayLogs] Consumer started", {
    group: GROUP_NAME,
    consumer: CONSUMER_NAME,
    batchSize: BATCH_SIZE,
  });

  consumerClient = createBlockingRedisClient();
  await consumerClient.connect().catch(() => undefined);

  while (isRunning) {
    try {
      // 使用 XREADGROUP 从消费者组读取消息
      // ">" 表示只读取从未被消费过的消息（新消息）
      const result = await consumerClient.xreadgroup(
        "GROUP",
        GROUP_NAME,
        CONSUMER_NAME,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        BLOCK_MS,
        "STREAMS",
        LOG_STREAM,
        ">"
      );

      if (!result || result.length === 0) continue;

      for (const [, messages] of result as Array<[string, Array<[string, string[]]>]>) {
        if (!messages || messages.length === 0) continue;

        for (const [id, fields] of messages) {
          const payloadIndex = fields.findIndex((f) => f === "payload");
          const payloadStr = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;

          if (!payloadStr) {
            // 无效消息，直接确认跳过
            await redisCommandClient.xack(LOG_STREAM, GROUP_NAME, id).catch(() => {});
            console.warn(`[GatewayLogs] Empty payload for message ${id}, acked`);
            continue;
          }

          try {
            const event = JSON.parse(payloadStr) as GatewayLogEvent;
            await persistLogEvent(event);

            // ✅ 成功写入 DB 后，确认消息（从 PEL 中移除）
            await redisCommandClient.xack(LOG_STREAM, GROUP_NAME, id);
            console.log(`[GatewayLogs] Processed and acked ${id.slice(0, 8)}`);
          } catch (err) {
            console.error(`[GatewayLogs] Failed to process ${id}:`, err);
            // 不 ACK，消息会留在 Pending Entries List 中
            // 可以后续通过监控 PEL 来发现和处理失败的消息
          }
        }
      }
    } catch (error) {
      if (!isRunning) break;
      console.error("[GatewayLogs] Redis XREADGROUP error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};

/**
 * 检查 Pending Entries List 中的消息（用于监控和重试）
 */
export const checkPendingMessages = async () => {
  try {
    // 获取 PEL 概要信息
    const pending = await redisCommandClient.xpending(LOG_STREAM, GROUP_NAME);
    // pending 格式: [total, firstId, lastId, [consumerName, count][]]
    if (!pending || pending[0] === 0) {
      return { total: 0, consumers: [] };
    }

    const [total, firstId, lastId, consumers] = pending;
    return {
      total: Number(total),
      firstId,
      lastId,
      consumers: consumers as Array<[string, string]>,
    };
  } catch (err) {
    console.error("[GatewayLogs] Failed to check pending:", err);
    return { total: 0, consumers: [], error: String(err) };
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
