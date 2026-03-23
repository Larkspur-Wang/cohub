import Redis from "ioredis";
import { GatewayInboundEvent, GatewayOutboundCommand } from "@cohub/protocol";

// 这里我们暂时硬编码 redis 的 url，后续可以通过 env 传入
export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export const INBOUND_STREAM = "stream:gateway:inbound";
export const OUTBOUND_STREAM = "stream:gateway:outbound";

// 发送给 API
export const publishInboundEvent = async (event: GatewayInboundEvent) => {
  await redis.xadd(
    INBOUND_STREAM,
    "*", // 自动生成 ID
    "payload",
    JSON.stringify(event)
  );
};

// 监听 API 发来的指令
export const listenOutboundCommands = async (
  onCommand: (cmd: GatewayOutboundCommand) => Promise<void>
) => {
  let lastId = "$"; // 从最新的开始读，真实业务中可能需要持久化 lastId 或用 Consumer Group
  
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
          const payloadIndex = fields.findIndex((f) => f === "payload");
          if (payloadIndex !== -1) {
            const cmd = JSON.parse(fields[payloadIndex + 1]) as GatewayOutboundCommand;
            await onCommand(cmd).catch((err) => {
              console.error(`Failed to process outbound command ${cmd.commandId}:`, err);
            });
          }
        }
      }
    } catch (error) {
      console.error("Redis XREAD Error:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
};
