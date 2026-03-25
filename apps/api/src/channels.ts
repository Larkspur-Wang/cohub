import { eq, and } from "drizzle-orm";
import { db } from "./db/index.js";
import { runtimeChannels, runtimeSessionBindings, userChannels } from "./db/schema.js";
import { redisCommandClient } from "./redis.js";
import type { GatewayInboundEvent, GatewayOutboundCommand, UnifiedContentBlock, ChannelProvider } from "@cohub/protocol";
import { randomUUID } from "node:crypto";
import { createUserMessageNode, enqueueRuntimePrompt, registerRuntimeSession } from "./runtime-sessions.js";

/**
 * 分配算法：目前简单采用随机分配活跃节点
 */
async function pickGatewayNode(): Promise<string> {
  const now = Date.now();
  // 获取 15 秒内有心跳的节点
  const activeNodes = await redisCommandClient.zrangebyscore("gateway:nodes", now - 15000, "+inf");

  if (activeNodes.length === 0) {
    throw new Error("No active gateway nodes available");
  }

  const nodeId = activeNodes[Math.floor(Math.random() * activeNodes.length)];
  if (!nodeId) {
    throw new Error("Failed to pick gateway node");
  }
  return nodeId;
}

/**
 * 将 Runtime 关联的所有渠道拉起并分配给 Gateway 节点
 */
export async function bindRuntimeChannelsToGateway(runtimeId: string) {
  const rcs = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.runtimeId, runtimeId));

  for (const rc of rcs) {
    const [uc] = await db
      .select()
      .from(userChannels)
      .where(eq(userChannels.id, rc.channelId))
      .limit(1);

    if (!uc || uc.status !== "active") continue;

    const nodeId = await pickGatewayNode();

    // 构造分配给 Gateway 的配置
    const config = {
      channelId: rc.id, // 这里我们让 gateway 内部使用 runtime_channels.id 作为 key
      provider: uc.provider,
      credentials: uc.credentials,
    };

    // 1. 塞进节点的专属任务 Hash
    await redisCommandClient.hset(`gateway:tasks:${nodeId}`, rc.id, JSON.stringify(config));

    // 2. 记录路由反查表
    await redisCommandClient.hset("gateway:channel_routing", rc.id, nodeId);

    console.log(`[Channels] Assigned channel ${rc.id} to gateway node ${nodeId}`);
  }
}

/**
 * 推送出站消息到对应的 Gateway 节点
 */
export async function dispatchOutboundMessage(input: {
  runtimeChannelId: string;
  externalChatId?: string | null;
  content: UnifiedContentBlock[];
  replyToExternalMessageId?: string;
}) {
  // 1. 查找该渠道目前归哪个节点管
  const nodeId = await redisCommandClient.hget("gateway:channel_routing", input.runtimeChannelId);
  if (!nodeId) {
    console.warn(`[Channels] No routing found for channel ${input.runtimeChannelId}`);
    return;
  }

  // 2. 查出渠道的详细信息 (provider)
  const [rc] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, input.runtimeChannelId))
    .limit(1);

  if (!rc) return;

  const [uc] = await db
    .select()
    .from(userChannels)
    .where(eq(userChannels.id, rc.channelId))
    .limit(1);

  if (!uc) return;

  const resolvedExternalChatId = input.externalChatId?.trim();
  if (!resolvedExternalChatId) {
    console.warn(
      `[Channels] Skip outbound for runtimeChannel=${input.runtimeChannelId}: missing externalChatId`,
    );
    return;
  }

  const command: GatewayOutboundCommand = {
    commandId: randomUUID(),
    timestamp: Date.now(),
    channelId: rc.id,
    provider: uc.provider as ChannelProvider,
    externalChatId: resolvedExternalChatId,
    content: input.content,
    replyToExternalMessageId: input.replyToExternalMessageId,
  };

  console.log(
    `[Channels] Dispatch outbound runtimeChannel=${input.runtimeChannelId} provider=${command.provider} externalChatId=${command.externalChatId} replyTo=${command.replyToExternalMessageId ?? "none"}`,
  );

  // 3. 塞进 Outbound Stream
  await redisCommandClient.xadd(
    "stream:gateway:outbound",
    "*",
    "payload",
    JSON.stringify(command)
  );
}

export async function getBindingByRuntimeChannelAndKey(input: {
  runtimeChannelId: string;
  bindingKey: string;
}) {
  const [binding] = await db
    .select()
    .from(runtimeSessionBindings)
    .where(
      and(
        eq(runtimeSessionBindings.runtimeChannelId, input.runtimeChannelId),
        eq(runtimeSessionBindings.bindingKey, input.bindingKey),
      ),
    )
    .limit(1);

  return binding ?? null;
}

export async function getBindingsByRuntimeId(runtimeId: string) {
  return db
    .select()
    .from(runtimeSessionBindings)
    .where(eq(runtimeSessionBindings.runtimeId, runtimeId));
}

export async function getBindingsBySessionId(runtimeSessionId: string) {
  return db
    .select()
    .from(runtimeSessionBindings)
    .where(eq(runtimeSessionBindings.runtimeSessionId, runtimeSessionId));
}

export async function getBindingBySessionId(runtimeSessionId: string) {
  const [binding] = await getBindingsBySessionId(runtimeSessionId);
  return binding ?? null;
}

export async function createRuntimeSessionBinding(input: {
  runtimeId: string;
  runtimeSessionId: string;
  runtimeChannelId: string;
  provider: string;
  bindingKey: string;
  externalChatId: string;
  meta?: Record<string, unknown> | null;
}) {
  const [binding] = await db
    .insert(runtimeSessionBindings)
    .values({
      runtimeId: input.runtimeId,
      runtimeSessionId: input.runtimeSessionId,
      runtimeChannelId: input.runtimeChannelId,
      provider: input.provider,
      bindingKey: input.bindingKey,
      externalChatId: input.externalChatId,
      status: "active",
      meta: input.meta ?? null,
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [runtimeSessionBindings.runtimeChannelId, runtimeSessionBindings.bindingKey],
      set: {
        runtimeId: input.runtimeId,
        runtimeSessionId: input.runtimeSessionId,
        provider: input.provider,
        externalChatId: input.externalChatId,
        status: "active",
        meta: input.meta ?? null,
        updatedAt: new Date(),
        lastMessageAt: new Date(),
      },
    })
    .returning();

  if (!binding) {
    throw new Error("Failed to create runtime session binding");
  }

  return binding;
}

export async function touchRuntimeSessionBinding(bindingId: string) {
  await db
    .update(runtimeSessionBindings)
    .set({ updatedAt: new Date(), lastMessageAt: new Date() })
    .where(eq(runtimeSessionBindings.id, bindingId));
}

/**
 * 处理网关发来的入站事件
 */
export async function handleInboundEvent(event: GatewayInboundEvent) {
  // 1. 寻找匹配的 Runtime Channel 绑定关系
  // 注意：event.channelId 在这里其实是 runtime_channels.id
  const [rc] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, event.channelId))
    .limit(1);

  if (!rc) {
    console.warn(`[Channels] Received inbound event for unknown runtime-channel: ${event.channelId}`);
    return;
  }

  // 2. 寻找或创建对应的 Session Binding
  const bindingKey =
    (event as GatewayInboundEvent & { bindingKey?: string }).bindingKey ??
    `${event.provider}:${event.externalChatId}`;

  let binding = await getBindingByRuntimeChannelAndKey({
    runtimeChannelId: rc.id,
    bindingKey,
  });

  let sessionId = binding?.runtimeSessionId ?? null;

  if (!sessionId) {
    const session = await registerRuntimeSession({
      runtimeId: rc.runtimeId,
      sessionId: randomUUID(),
      title: `${event.provider}:${event.externalChatId}`,
      protocol: "pi",
      cwd: null,
      externalSessionId: null,
      meta: {
        source: `channel:${event.provider}`,
        createdFrom: "gateway_inbound",
      },
    });

    binding = await createRuntimeSessionBinding({
      runtimeId: rc.runtimeId,
      runtimeSessionId: session.id,
      runtimeChannelId: rc.id,
      provider: event.provider,
      bindingKey,
      externalChatId: event.externalChatId,
      meta: null,
    });

    sessionId = session.id;
  } else if (binding) {
    await touchRuntimeSessionBinding(binding.id);
  }

  // 3. 将消息注入到系统（模拟用户在 Web 端的操作）
  const textBlock = event.content.find((block): block is { type: 'text'; text: string } => block.type === 'text');
  const text = textBlock?.text || "";
  const images = event.content
    .filter((block): block is { type: 'image'; uri: string } => block.type === 'image' && !!block.uri)
    .map((block) => ({ url: block.uri }));

  const userMessage = await createUserMessageNode({
    runtimeSessionId: sessionId,
    text,
    images,
    branchFromMessageId: null, // 默认在叶子节点继续
  });

  // 4. 触发 Agent 运行
  await enqueueRuntimePrompt({
    runtimeId: rc.runtimeId,
    sessionId,
    userMessageId: userMessage.id,
    branchFromMessageId: null,
    message: { text, images },
    meta: { intent: "continue", source: `channel:${event.provider}` },
  });
}
