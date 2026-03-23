import os from "node:os";
import { redis } from "../bus.js";
import { DiscordProvider } from "../providers/discord/index.js";

export class GatewayManager {
  public readonly nodeId: string;
  private heartbeatInterval?: Timer;
  private syncInterval?: Timer;
  
  // 本地维持的实例集合 Map<ChannelId, ProviderInstance>
  private providers = new Map<string, DiscordProvider>();

  constructor() {
    // 优先使用 k8s 的 pod name (如 gateway-0)，回退到 hostname，再回退到随机生成的 id
    this.nodeId = process.env.POD_NAME || os.hostname() || `gw-${Math.random().toString(36).slice(2, 8)}`;
  }

  public async start() {
    console.log(`[Manager] Starting Gateway Node: ${this.nodeId}`);
    
    // 1. 立即注册并开启心跳
    await this.registerNode();
    this.heartbeatInterval = setInterval(() => this.registerNode(), 5000);

    // 2. 立即全量同步一次，并开启定时同步
    await this.syncTasks();
    this.syncInterval = setInterval(() => this.syncTasks(), 10000);
  }

  public async stop() {
    console.log(`[Manager] Stopping Gateway Node: ${this.nodeId}`);
    
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);

    // 清理本地所有的长连接
    for (const [channelId, provider] of this.providers.entries()) {
      try {
        provider.destroy();
      } catch (err) {
        console.error(`[Manager] Error destroying provider for ${channelId}:`, err);
      }
    }
    this.providers.clear();

    // 从活跃节点中注销自己 (让 API 更快发现)
    await redis.zrem("gateway:nodes", this.nodeId).catch(console.error);
  }

  private async registerNode() {
    try {
      // 使用 ZSET 记录节点和它的最后心跳时间 (用于 API 剔除死节点)
      await redis.zadd("gateway:nodes", Date.now(), this.nodeId);
    } catch (error) {
      console.error(`[Manager] Failed to send heartbeat:`, error);
    }
  }

  private async syncTasks() {
    try {
      // 获取分配给本节点的专属任务
      // 数据结构: HASH gateway:tasks:<nodeId>
      // Field: channelId, Value: JSON string of ChannelConfig
      const tasksStr = await redis.hgetall(`gateway:tasks:${this.nodeId}`);
      
      const expectedChannelIds = new Set(Object.keys(tasksStr));
      const currentChannelIds = new Set(this.providers.keys());

      // 1. 需要新增或更新的连接
      for (const channelId of expectedChannelIds) {
        if (!currentChannelIds.has(channelId)) {
          const config = JSON.parse(tasksStr[channelId]);
          this.startProvider(channelId, config);
        }
        // TODO: 如果配置变了(比如 token 变了)，可能需要重启 provider
      }

      // 2. 需要断开的连接 (本地有，但 Redis 里没有了)
      for (const channelId of currentChannelIds) {
        if (!expectedChannelIds.has(channelId)) {
          this.stopProvider(channelId);
        }
      }

    } catch (error) {
      console.error(`[Manager] Failed to sync tasks:`, error);
    }
  }

  private startProvider(channelId: string, config: any) {
    console.log(`[Manager] Starting provider for channel ${channelId} (${config.provider})`);
    try {
      if (config.provider === "discord") {
        const provider = new DiscordProvider(channelId, config.credentials.token);
        this.providers.set(channelId, provider);
      } else {
        console.warn(`[Manager] Unsupported provider: ${config.provider}`);
      }
    } catch (error) {
      console.error(`[Manager] Error starting provider for ${channelId}:`, error);
    }
  }

  private stopProvider(channelId: string) {
    console.log(`[Manager] Stopping provider for channel ${channelId}`);
    const provider = this.providers.get(channelId);
    if (provider) {
      try {
        provider.destroy();
      } catch (error) {
        console.error(`[Manager] Error destroying provider for ${channelId}:`, error);
      }
      this.providers.delete(channelId);
    }
  }

  // 供 index.ts 使用，当收到 API 的 outbound 消息时路由给具体的 provider
  public getProvider(channelId: string) {
    return this.providers.get(channelId);
  }
}
