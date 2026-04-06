import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { GatewayManager } from "./manager/index.js";
import { listenOutboundCommands, initOutboundConsumerGroup, INBOUND_STREAM, OUTBOUND_STREAM } from "./bus.js";
import { createBlockingRedisClient, xaddWithMaxlen } from "./redis.js";
import type { GatewayInboundEvent, GatewayOutboundCommand } from "@cohub/protocol";
import { gatewayConfig } from "./config.js";
import { redisCommandClient } from "./redis.js";

function logStartupInfo() {
  console.log("=".repeat(60));
  console.log("[Gateway] Starting with configuration:");
  console.log(`  NODE_ID: ${process.env.POD_NAME || process.env.HOSTNAME || "unknown"}`);
  console.log(`  ENV: ${process.env.ENV || "unknown"}`);
  console.log(`  DEBUG_MODE: ${process.env.DEBUG_MODE || "false"}`);
  console.log(`  REDIS_URL: ${process.env.REDIS_URL ? `${process.env.REDIS_URL.slice(0, 30)}...` : "not set"}`);
  console.log(`  API_BASE_URL: ${gatewayConfig.apiBaseUrl}`);
  console.log(`  PORT: ${gatewayConfig.port}`);
  console.log("=".repeat(60));
}

async function main() {
  logStartupInfo();

  await initOutboundConsumerGroup();

  const manager = new GatewayManager();
  await manager.start();

  console.log("[Gateway] Listening for outbound commands from API...");

  listenOutboundCommands(async (cmd: GatewayOutboundCommand) => {
    console.log("[Gateway] Received outbound command:", {
      commandId: cmd.commandId,
      channelId: cmd.channelId,
      provider: cmd.provider,
      externalChatId: cmd.externalChatId,
      contentPreview: cmd.content.map((c) => c.type).join(", "),
    });

    const provider = manager.getProvider(cmd.channelId);
    if (!provider) {
      console.warn(`[Gateway] Command rejected: provider not found for channel ${cmd.channelId}`);
      console.warn(`[Gateway] Active channels: ${manager.getActiveChannelIds().join(", ") || "none"}`);
      return { success: false, error: `Provider not found for channel ${cmd.channelId}` };
    }

    console.log(`[Gateway] Routing command ${cmd.commandId} to ${cmd.provider} provider`);
    const result = await provider.handleOutbound(cmd);
    console.log(`[Gateway] Command ${cmd.commandId} result:`, result.success ? "success" : `failed: ${result.error}`);
    return result;
  }).catch((error) => {
    console.error("[Gateway] Fatal error listening to outbound stream:", error);
  });

  const app = new Hono();

  app.use("*", cors());

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    const checks: Record<string, boolean> = {};

    // 1. Redis connectivity
    try {
      await redisCommandClient.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }

    // 2. Manager initialization completed
    checks.manager = manager.started;

    const ready = Object.values(checks).every(Boolean);
    return c.json({ ready, checks }, ready ? 200 : 503);
  });

  serve({ fetch: app.fetch, port: gatewayConfig.port });
  console.log(`@cohub/gateway listening on :${gatewayConfig.port}`);

  const shutdown = async () => {
    console.log("[Gateway] Received shutdown signal, stopping...");
    await manager.stop();
    console.log("[Gateway] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  if (process.env.DEBUG_MODE === "true") {
    console.log("[Gateway] DEBUG_MODE enabled.");

    const startDebugProvider = async (channelId: string, providerType: string, token: string) => {
      console.log(`[Debug] Initializing test channel: ${channelId} (${providerType})`);

      if (providerType === "discord") {
        const { DiscordProvider } = await import("./providers/discord/index.js");
        const provider = new DiscordProvider(channelId, token);
        // @ts-ignore
        manager.providers.set(channelId, provider);
      }
    };

    if (process.env.DEBUG_DISCORD_BOT_TOKEN) {
      await startDebugProvider("debug-discord", "discord", process.env.DEBUG_DISCORD_BOT_TOKEN);
    }
    if (process.env.DEBUG_TELEGRAM_BOT_TOKEN) {
      await startDebugProvider("debug-telegram", "telegram", process.env.DEBUG_TELEGRAM_BOT_TOKEN);
    }

    const redis = createBlockingRedisClient();

    await redis.connect().catch(() => undefined);

    (async () => {
      let lastId = "$";
      while (true) {
        const result = await redis.xread("BLOCK", 0, "STREAMS", INBOUND_STREAM, lastId);
        if (!result) continue;
        for (const [, messages] of result) {
          for (const [id, fields] of messages) {
            lastId = id;
            const payloadIdx = fields.indexOf("payload");
            const payloadStr = payloadIdx >= 0 ? fields[payloadIdx + 1] : undefined;
            if (!payloadStr) continue;

            const payload = JSON.parse(payloadStr) as GatewayInboundEvent;

            if (payload.channelId.startsWith("debug-")) {
              console.log(`[Debug] Received ping from ${payload.sender.name} via ${payload.provider}, sending pong...`);
              const pongCmd: GatewayOutboundCommand = {
                commandId: `pong-${Date.now()}`,
                timestamp: Date.now(),
                channelId: payload.channelId,
                provider: payload.provider,
                externalChatId: payload.externalChatId,
                content: [{ type: "text", text: `pong from ${payload.provider} 🏓` }],
                replyToExternalMessageId: payload.externalMessageId,
              };
              await xaddWithMaxlen(redis, OUTBOUND_STREAM, "*", "payload", JSON.stringify(pongCmd));
            }
          }
        }
      }
    })().catch(console.error);
  }
}

main().catch(console.error);
