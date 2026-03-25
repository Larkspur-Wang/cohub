import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { GatewayInboundEvent, GatewayOutboundCommand, GatewayLogEvent } from "@cohub/protocol";

// 这里我们暂时硬编码 redis 的 url，后续可以通过 env 传入
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
console.log(`[Bus] Connecting to Redis: ${redisUrl.slice(0, 30)}...`);

export const redis = new Redis(redisUrl);

// Redis 连接事件
redis.on("connect", () => {
  console.log("[Bus] Redis connected successfully");
});

redis.on("error", (err) => {
  console.error("[Bus] Redis connection error:", err);
});

redis.on("close", () => {
  console.warn("[Bus] Redis connection closed");
});

redis.on("reconnecting", () => {
  console.log("[Bus] Redis reconnecting...");
});

export const INBOUND_STREAM = "stream:gateway:inbound";
export const OUTBOUND_STREAM = "stream:gateway:outbound";
export const LOG_STREAM = "stream:gateway:logs";

console.log(`[Bus] Stream names: inbound=${INBOUND_STREAM}, outbound=${OUTBOUND_STREAM}, logs=${LOG_STREAM}`);

// 发送日志事件给 API（内部函数）
const publishLogEvent = async (event: GatewayLogEvent) => {
  console.log("[Bus] Publishing log event:", {
    logId: event.logId.slice(0, 8),
    direction: event.direction,
    provider: event.provider,
    channelId: event.channelId,
    status: event.status,
  });
  await redis.xadd(LOG_STREAM, "*", "payload", JSON.stringify(event)).catch((err) => {
    console.error("[Bus] Failed to publish log event:", err);
  });
};

// 发送给 API（同时记录 inbound 日志）
export const publishInboundEvent = async (event: GatewayInboundEvent) => {
  console.log("[Bus] Publishing inbound event:", {
    eventId: event.eventId.slice(0, 8),
    provider: event.provider,
    channelId: event.channelId,
    sender: event.sender.name,
    contentPreview: event.content.map(c => c.type).join(", "),
  });

  // 并行发送：主事件 + 日志事件
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
    redis.xadd(INBOUND_STREAM, "*", "payload", JSON.stringify(event)),
    publishLogEvent(logEvent),
  ]);

  console.log(`[Bus] Inbound event ${event.eventId.slice(0, 8)} published successfully`);
};

// 发送 outbound 日志事件
export const publishOutboundLog = async (input: {
  cmd: GatewayOutboundCommand;
  result: { success: boolean; error?: string; externalMessageId?: string };
}) => {
  const logEvent: GatewayLogEvent = {
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
  };
  await publishLogEvent(logEvent);
};

// 监听 API 发来的指令
export const listenOutboundCommands = async (
  onCommand: (cmd: GatewayOutboundCommand) => Promise<{ success: boolean; error?: string; externalMessageId?: string }>
) => {
  console.log(`[Bus] Starting to listen on stream: ${OUTBOUND_STREAM}`);
  let lastId = "$"; // 从最新的开始读，真实业务中可能需要持久化 lastId 或用 Consumer Group
  console.log(`[Bus] Starting from: ${lastId} (latest)`);

  while (true) {
    try {
      const result = await redis.xread(
        "BLOCK",
        0, // 永久阻塞
        "STREAMS",
        OUTBOUND_STREAM,
        lastId
      );

      if (!result) continue;

      for (const [stream, messages] of result) {
        for (const [id, fields] of messages) {
          lastId = id;
          console.log(`[Bus] Received message ${id} from stream ${stream}`);

          const payloadIndex = fields.findIndex((f: string) => f === "payload");
          const payloadStr = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;
          if (payloadStr) {
            const cmd = JSON.parse(payloadStr) as GatewayOutboundCommand;
            console.log("[Bus] Processing outbound command:", {
              commandId: cmd.commandId,
              channelId: cmd.channelId,
              provider: cmd.provider,
            });

            const handleResult = await onCommand(cmd).catch((err) => {
              console.error(`[Bus] Failed to process outbound command ${cmd.commandId}:`, err);
              return { success: false as const, error: err instanceof Error ? err.message : String(err) };
            });

            // 记录 outbound 日志
            await publishOutboundLog({ cmd, result: handleResult });
          }
        }
      }
    } catch (error) {
      console.error("[Bus] Redis XREAD Error:", error);
      console.log("[Bus] Retrying in 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};
