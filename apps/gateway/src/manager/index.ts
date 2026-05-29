import os from "node:os";
import { redisCommandClient } from "../redis.js";
import { DiscordProvider } from "../providers/discord/index.js";
import { FeishuProvider } from "../providers/feishu/index.js";
import type { GatewayProvider } from "../providers/base.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-gateway" });
const GATEWAY_NODE_TTL_MS = 15_000;

interface ChannelConfig {
  provider: string;
  credentials: Record<string, string>;
  externalChatId?: string;
}

export class GatewayManager {
  public readonly nodeId: string;
  public started = false;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private syncInterval?: ReturnType<typeof setInterval>;

  // 本地维持的实例集合 Map<ChannelId, ProviderInstance>
  private providers = new Map<string, GatewayProvider>();

  constructor() {
    // 优先使用 k8s 的 pod name (如 gateway-0)，回退到 hostname，再回退到随机生成的 id
    this.nodeId = process.env.POD_NAME || os.hostname() || `gw-${Math.random().toString(36).slice(2, 8)}`;
  }

  public async start() {
    logger.info(`[Manager] Starting Gateway Node: ${this.nodeId}`);

    // 1. 立即注册并开启心跳
    logger.info("[Manager] Sending initial heartbeat...");
    await this.registerNode();
    logger.info("[Manager] Initial heartbeat sent, starting heartbeat loop (interval: 5s)");
    this.heartbeatInterval = setInterval(() => this.registerNode(), 5000);

    // 2. 立即全量同步一次，并开启定时同步
    logger.info("[Manager] Performing initial task sync...");
    await this.syncTasks();
    logger.info("[Manager] Initial sync complete, starting sync loop (interval: 10s)");
    this.syncInterval = setInterval(() => this.syncTasks(), 10000);

    logger.info(`[Manager] Gateway Node ${this.nodeId} started successfully`);
    this.started = true;
  }

  public async stop() {
    logger.info(`[Manager] Stopping Gateway Node: ${this.nodeId}`);
    logger.info(`[Manager] Active providers to stop: ${this.providers.size}`);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      logger.info("[Manager] Heartbeat loop stopped");
    }
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      logger.info("[Manager] Sync loop stopped");
    }

    const channelIds = Array.from(this.providers.keys());

    // 清理本地所有的长连接
    for (const [channelId, provider] of this.providers.entries()) {
      try {
        logger.info(`[Manager] Destroying provider for ${channelId}...`);
        provider.destroy();
      } catch (err) {
        logger.error(`[Manager] Error destroying provider for ${channelId}:`, err);
      }
    }
    this.providers.clear();

    // 从活跃节点中注销自己 (让 API 更快发现)
    logger.info("[Manager] Unregistering node from gateway:nodes...");
    await redisCommandClient.zrem("gateway:nodes", this.nodeId).catch((error) => logger.error("[Manager] failed to unregister gateway node", { nodeId: this.nodeId, error }));

    // 清理本节点的任务列表和 channel 路由
    logger.info("[Manager] Cleaning up task assignments...");
    for (const channelId of channelIds) {
      // 从全局路由表中移除（如果当前节点仍然持有该 channel）
      const currentNode = await redisCommandClient.hget("gateway:channel_routing", channelId);
      if (currentNode === this.nodeId) {
        await redisCommandClient.hdel("gateway:channel_routing", channelId).catch((error) => logger.error("[Manager] failed to remove channel routing", { nodeId: this.nodeId, channelId, error }));
        logger.info(`[Manager] Removed routing for channel ${channelId}`);
      }
    }
    // 删除本节点的任务列表
    await redisCommandClient.del(`gateway:node:${this.nodeId}:channels`).catch((error) => logger.error("[Manager] failed to cleanup node channel assignments", { nodeId: this.nodeId, error }));
    logger.info(`[Manager] Cleaned up ${channelIds.length} task assignments`);

    logger.info(`[Manager] Node ${this.nodeId} stopped`);
  }

  private async registerNode() {
    try {
      const now = Date.now();
      const staleBefore = now - GATEWAY_NODE_TTL_MS;
      // 使用 ZSET 记录节点和它的最后心跳时间 (用于 API 剔除死节点)
      await redisCommandClient
        .multi()
        .zadd("gateway:nodes", now, this.nodeId)
        .zremrangebyscore("gateway:nodes", 0, staleBefore)
        .exec();
    } catch (error) {
      logger.error("[Manager] Failed to send heartbeat:", error);
    }
  }

  private async syncTasks() {
    try {
      const syncStart = Date.now();
      // 获取分配给本节点的专属任务
      // 数据结构: HASH gateway:node:<nodeId>:channels
      // Field: channelId, Value: JSON string of ChannelConfig
      const tasksStr = await redisCommandClient.hgetall(`gateway:node:${this.nodeId}:channels`);

      const expectedChannelIds = new Set(Object.keys(tasksStr));
      const currentChannelIds = new Set(this.providers.keys());

      logger.info(`[Manager] Sync tasks: expected=${expectedChannelIds.size}, current=${currentChannelIds.size}`);
      if (expectedChannelIds.size > 0) {
        logger.info(`[Manager] Expected channels: [${Array.from(expectedChannelIds).join(", ")}]`);
      }
      if (currentChannelIds.size > 0) {
        logger.info(`[Manager] Current channels: [${Array.from(currentChannelIds).join(", ")}]`);
      }

      // 1. 需要新增或更新的连接
      const toAdd = Array.from(expectedChannelIds).filter(id => !currentChannelIds.has(id));
      const toRemove = Array.from(currentChannelIds).filter(id => !expectedChannelIds.has(id));

      if (toAdd.length > 0) {
        logger.info(`[Manager] Channels to add: [${toAdd.join(", ")}]`);
      }
      if (toRemove.length > 0) {
        logger.info(`[Manager] Channels to remove: [${toRemove.join(", ")}]`);
      }

      for (const channelId of toAdd) {
        const configStr = tasksStr[channelId];
        if (configStr) {
          const config = JSON.parse(configStr);
          this.startProvider(channelId, config);
        }
      }
      // TODO: 如果配置变了(比如 token 变了)，可能需要重启 provider

      // 2. 需要断开的连接 (本地有，但 Redis 里没有了)
      for (const channelId of toRemove) {
        await this.stopProvider(channelId);
      }

      logger.info(`[Manager] Sync completed in ${Date.now() - syncStart}ms`);
    } catch (error) {
      logger.error("[Manager] Failed to sync tasks:", error);
    }
  }

  private startProvider(channelId: string, config: ChannelConfig) {
    logger.info(`[Manager] Starting provider for channel ${channelId} (${config.provider})`);
    try {
      if (config.provider === "discord") {
        const provider = new DiscordProvider(channelId, config.credentials.token as string);
        this.providers.set(channelId, provider);
        logger.info(`[Manager] Provider for ${channelId} created and added to active providers`);
      } else if (config.provider === "feishu") {
        const provider = new FeishuProvider(channelId, {
          appId: config.credentials.appId as string,
          appSecret: config.credentials.appSecret as string,
          brand: (config.credentials.brand as "feishu" | "lark") ?? "feishu",
        });
        this.providers.set(channelId, provider);
        logger.info(`[Manager] Provider for ${channelId} created and added to active providers`);
      } else {
        logger.warn(`[Manager] Unsupported provider: ${config.provider}`);
      }
    } catch (error) {
      logger.error(`[Manager] Error starting provider for ${channelId}:`, error);
    }
  }

  private async stopProvider(channelId: string) {
    logger.info(`[Manager] Stopping provider for ${channelId}`);
    const provider = this.providers.get(channelId);
    if (provider) {
      try {
        provider.destroy();
        logger.info(`[Manager] Provider for ${channelId} destroyed`);
      } catch (error) {
        logger.error(`[Manager] Error destroying provider for ${channelId}:`, error);
      }
      this.providers.delete(channelId);
    }

    // 尝试清理路由表（如果当前节点仍然持有该 channel）
    try {
      const currentNode = await redisCommandClient.hget("gateway:channel_routing", channelId);
      if (currentNode === this.nodeId) {
        await redisCommandClient.hdel("gateway:channel_routing", channelId);
        logger.info(`[Manager] Removed routing for channel ${channelId}`);
      }
    } catch (error) {
      logger.error(`[Manager] Error cleaning up routing for ${channelId}:`, error);
    }
  }

  // 供 index.ts 使用，当收到 API 的 outbound 消息时路由给具体的 provider
  public getProvider(channelId: string) {
    return this.providers.get(channelId);
  }

  // 获取当前活跃的 channel IDs (用于 debug)
  public getActiveChannelIds(): string[] {
    return Array.from(this.providers.keys());
  }
}
