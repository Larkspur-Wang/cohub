import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "./db/index.js";
import { providerMessageRefs, runtimeChannels, runtimeSessionBindings, userChannels } from "./db/schema.js";
import { redisCommandClient, GATEWAY_OUTBOUND_STREAM, xaddWithMaxlen } from "./redis.js";
import type {
  GatewayInboundEvent,
  GatewayOutboundCommand,
  UnifiedContentBlock,
  ChannelProvider,
  RuntimeChannelConfig,
} from "@cohub/protocol";
import { randomUUID } from "node:crypto";
import { createUserMessageNode, enqueueRuntimePrompt, forkRuntimeSession, registerRuntimeSession } from "./runtime-sessions.js";

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

const getRuntimeChannelConfigKey = (runtimeChannelId: string) => `gateway:runtime_channel_config:${runtimeChannelId}`;

export async function syncRuntimeChannelConfigCache(input: {
  runtimeChannelId: string;
  config: RuntimeChannelConfig | Record<string, unknown> | null;
}) {
  const key = getRuntimeChannelConfigKey(input.runtimeChannelId);
  const payload = JSON.stringify(input.config ?? {});
  await redisCommandClient.set(key, payload);
}

export async function getRuntimeChannelRecord(runtimeChannelId: string) {
  const [rc] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, runtimeChannelId))
    .limit(1);

  return rc ?? null;
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

    // 检查 channel 是否已经被分配且目标节点仍然活跃
    const existingNodeId = await redisCommandClient.hget("gateway:channel_routing", rc.id);
    if (existingNodeId) {
      const now = Date.now();
      const nodeLastHeartbeatStr = await redisCommandClient.zscore("gateway:nodes", existingNodeId);
      const nodeLastHeartbeat = typeof nodeLastHeartbeatStr === "string" ? Number.parseFloat(nodeLastHeartbeatStr) : null;
      if (nodeLastHeartbeat && now - nodeLastHeartbeat < 15000) {
        console.log(`[Channels] Channel ${rc.id} already assigned to active node ${existingNodeId}, skipping`);
        continue;
      }
      console.log(`[Channels] Channel ${rc.id} was assigned to node ${existingNodeId} but node is inactive, reassigning`);
    }

    const nodeId = await pickGatewayNode();

    // 构造分配给 Gateway 的配置
    const config = {
      channelId: rc.id, // 这里我们让 gateway 内部使用 runtime_channels.id 作为 key
      provider: uc.provider,
      credentials: uc.credentials,
    };

    await syncRuntimeChannelConfigCache({
      runtimeChannelId: rc.id,
      config: (rc.config as RuntimeChannelConfig | Record<string, unknown> | null) ?? null,
    });

    // 1. 塞进节点的专属任务 Hash
    await redisCommandClient.hset(`gateway:node:${nodeId}:channels`, rc.id, JSON.stringify(config));

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
  runtimeId?: string;
  runtimeSessionId?: string;
  sessionMessageId?: string;
  provider?: string;
  externalChatId?: string | null;
  content: UnifiedContentBlock[];
  replyToExternalMessageId?: string;
  meta?: Record<string, unknown> | null;
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
    provider: (input.provider ?? uc.provider) as ChannelProvider,
    externalChatId: resolvedExternalChatId,
    content: input.content,
    replyToExternalMessageId: input.replyToExternalMessageId,
    runtimeId: input.runtimeId ?? rc.runtimeId,
    runtimeSessionId: input.runtimeSessionId,
    sessionMessageId: input.sessionMessageId,
    meta: input.meta ?? null,
  };

  console.log(
    `[Channels] Dispatch outbound runtimeChannel=${input.runtimeChannelId} provider=${command.provider} externalChatId=${command.externalChatId} replyTo=${command.replyToExternalMessageId ?? "none"}`,
  );

  // 3. 塞进 Outbound Stream（使用 MAXLEN 限制长度）
  await xaddWithMaxlen(
    redisCommandClient,
    GATEWAY_OUTBOUND_STREAM,
    "*",
    "payload",
    JSON.stringify(command),
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

export async function getRuntimeChannelsByRuntimeId(runtimeId: string) {
  return db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.runtimeId, runtimeId));
}

export async function getRuntimeChannelById(runtimeChannelId: string) {
  const [runtimeChannel] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, runtimeChannelId))
    .limit(1);

  return runtimeChannel ?? null;
}

export async function updateRuntimeChannelConfig(input: {
  runtimeChannelId: string;
  config: Record<string, unknown> | null;
}) {
  const [updated] = await db
    .update(runtimeChannels)
    .set({
      config: input.config ?? null,
    })
    .where(eq(runtimeChannels.id, input.runtimeChannelId))
    .returning();

  if (!updated) return null;

  await syncRuntimeChannelConfigCache({
    runtimeChannelId: updated.id,
    config: (updated.config as Record<string, unknown> | null) ?? null,
  });

  return updated;
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

export async function updateRuntimeSessionBindingMeta(input: {
  bindingId: string;
  meta: Record<string, unknown> | null;
}) {
  const [binding] = await db
    .select()
    .from(runtimeSessionBindings)
    .where(eq(runtimeSessionBindings.id, input.bindingId))
    .limit(1);

  if (!binding) return null;

  const mergedMeta = {
    ...((binding.meta as Record<string, unknown> | null) ?? {}),
    ...(input.meta ?? {}),
  };

  const [updated] = await db
    .update(runtimeSessionBindings)
    .set({
      meta: mergedMeta,
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .where(eq(runtimeSessionBindings.id, input.bindingId))
    .returning();

  return updated ?? null;
}

export async function createProviderMessageRef(input: {
  provider: string;
  runtimeId: string;
  runtimeSessionId: string;
  runtimeChannelId?: string | null;
  sessionMessageId?: string | null;
  direction: "inbound" | "outbound";
  externalConversationId: string;
  externalMessageId: string;
  parentExternalConversationId?: string | null;
  parentExternalMessageId?: string | null;
  externalAuthorId?: string | null;
  externalAuthorName?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  const [ref] = await db
    .insert(providerMessageRefs)
    .values({
      provider: input.provider,
      runtimeId: input.runtimeId,
      runtimeSessionId: input.runtimeSessionId,
      runtimeChannelId: input.runtimeChannelId ?? null,
      sessionMessageId: input.sessionMessageId ?? null,
      direction: input.direction,
      externalConversationId: input.externalConversationId,
      externalMessageId: input.externalMessageId,
      parentExternalConversationId: input.parentExternalConversationId ?? null,
      parentExternalMessageId: input.parentExternalMessageId ?? null,
      externalAuthorId: input.externalAuthorId ?? null,
      externalAuthorName: input.externalAuthorName ?? null,
      meta: input.meta ?? null,
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
        runtimeId: input.runtimeId,
        runtimeSessionId: input.runtimeSessionId,
        runtimeChannelId: input.runtimeChannelId ?? null,
        sessionMessageId: input.sessionMessageId ?? null,
        parentExternalConversationId: input.parentExternalConversationId ?? null,
        parentExternalMessageId: input.parentExternalMessageId ?? null,
        externalAuthorId: input.externalAuthorId ?? null,
        externalAuthorName: input.externalAuthorName ?? null,
        meta: input.meta ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return ref ?? null;
}

async function getProviderMessageRef(input: {
  provider: string;
  externalConversationId: string;
  externalMessageId: string;
  direction?: "inbound" | "outbound";
}) {
  const [ref] = await db
    .select()
    .from(providerMessageRefs)
    .where(
      input.direction
        ? and(
            eq(providerMessageRefs.provider, input.provider),
            eq(providerMessageRefs.externalConversationId, input.externalConversationId),
            eq(providerMessageRefs.externalMessageId, input.externalMessageId),
            eq(providerMessageRefs.direction, input.direction),
          )
        : and(
            eq(providerMessageRefs.provider, input.provider),
            eq(providerMessageRefs.externalConversationId, input.externalConversationId),
            eq(providerMessageRefs.externalMessageId, input.externalMessageId),
          ),
    )
    .orderBy(desc(providerMessageRefs.createdAt))
    .limit(1);

  return ref ?? null;
}

async function resolveForkSourceForInboundEvent(input: {
  runtimeId: string;
  runtimeChannelId: string;
  provider: string;
  conversationId: string;
  parentConversationId?: string | null;
  parentMessageId?: string | null;
}) {
  const parentConversationId = input.parentConversationId?.trim();
  const parentMessageId = input.parentMessageId?.trim();
  if (!parentConversationId || !parentMessageId) return null;

  const parentBindingKey = `${input.provider}:conversation:${parentConversationId}`;
  const parentBinding = await getBindingByRuntimeChannelAndKey({
    runtimeChannelId: input.runtimeChannelId,
    bindingKey: parentBindingKey,
  });
  if (!parentBinding) return null;

  const anchorRef = await getProviderMessageRef({
    provider: input.provider,
    externalConversationId: parentConversationId,
    externalMessageId: parentMessageId,
    direction: "inbound",
  });

  if (anchorRef?.sessionMessageId && anchorRef.runtimeSessionId === parentBinding.runtimeSessionId) {
    return {
      parentSessionId: parentBinding.runtimeSessionId,
      fromMessageId: anchorRef.sessionMessageId,
    };
  }

  const fallbackAnchorRef = await getProviderMessageRef({
    provider: input.provider,
    externalConversationId: parentConversationId,
    externalMessageId: parentMessageId,
  });

  if (fallbackAnchorRef?.sessionMessageId && fallbackAnchorRef.runtimeSessionId === parentBinding.runtimeSessionId) {
    return {
      parentSessionId: parentBinding.runtimeSessionId,
      fromMessageId: fallbackAnchorRef.sessionMessageId,
    };
  }

  return null;
}

function buildDefaultBindingMeta(event: GatewayInboundEvent) {
  return {
    conversation: event.conversation ?? null,
    message: event.message ?? null,
    providerMeta: event.meta ?? null,
    displayMode:
      event.conversation?.parentId || (event.conversation?.meta as Record<string, unknown> | null)?.isDm === true
        ? "compact"
        : "minimal",
    lifecycle: {
      sourceEventType: event.eventType ?? "message_create",
      precreated: event.eventType === "conversation_create",
      createdVia: event.eventType === "conversation_create" ? "conversation_create" : "message_create",
      lastEventAt: new Date(event.timestamp).toISOString(),
      lastEventId: event.eventId,
    },
    forkedFromExternal:
      event.conversation?.parentId && event.message?.parentMessageId
        ? {
            conversationId: event.conversation.parentId,
            messageId: event.message.parentMessageId,
          }
        : null,
  } as Record<string, unknown>;
}

async function resolveOrCreateSessionBindingForEvent(input: {
  runtimeId: string;
  runtimeChannelId: string;
  provider: string;
  externalChatId: string;
  bindingKey: string;
  event: GatewayInboundEvent;
}) {
  let binding = await getBindingByRuntimeChannelAndKey({
    runtimeChannelId: input.runtimeChannelId,
    bindingKey: input.bindingKey,
  });

  if (binding?.runtimeSessionId) {
    const lifecycleUpdate = {
      lifecycle: {
        sourceEventType: input.event.eventType ?? "message_create",
        precreated:
          ((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.precreated === true ||
          input.event.eventType === "conversation_create",
        createdVia:
          (((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.createdVia as string | undefined) ??
          (input.event.eventType === "conversation_create" ? "conversation_create" : "message_create"),
        lastEventAt: new Date(input.event.timestamp).toISOString(),
        lastEventId: input.event.eventId,
        lastMaterializedBy:
          input.event.eventType === "conversation_create"
            ? "conversation_create"
            : ((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.lastMaterializedBy ?? "message_create",
      },
    };
    await updateRuntimeSessionBindingMeta({
      bindingId: binding.id,
      meta: lifecycleUpdate,
    }).catch(console.error);
    await touchRuntimeSessionBinding(binding.id);
    return binding;
  }

  const forkSource = await resolveForkSourceForInboundEvent({
    runtimeId: input.runtimeId,
    runtimeChannelId: input.runtimeChannelId,
    provider: input.provider,
    conversationId: input.event.conversation?.id?.trim() || input.externalChatId,
    parentConversationId: input.event.conversation?.parentId ?? null,
    parentMessageId: input.event.message?.parentMessageId ?? null,
  });

  const session = forkSource
    ? await forkRuntimeSession({
        runtimeId: input.runtimeId,
        parentSessionId: forkSource.parentSessionId,
        fromMessageId: forkSource.fromMessageId,
        newSessionId: randomUUID(),
        title: `${input.provider}:${input.event.conversation?.id?.trim() || input.externalChatId}`,
      })
    : await registerRuntimeSession({
        runtimeId: input.runtimeId,
        sessionId: randomUUID(),
        title: `${input.provider}:${input.event.conversation?.id?.trim() || input.externalChatId}`,
        protocol: "pi",
        cwd: null,
        externalSessionId: null,
        meta: {
          source: `channel:${input.provider}`,
          createdFrom: input.event.eventType === "conversation_create" ? "gateway_conversation_create" : "gateway_inbound",
          conversation: input.event.conversation ?? null,
          providerMeta: input.event.meta ?? null,
        },
      });

  const bindingMeta = buildDefaultBindingMeta(input.event);

  binding = await createRuntimeSessionBinding({
    runtimeId: input.runtimeId,
    runtimeSessionId: session.id,
    runtimeChannelId: input.runtimeChannelId,
    provider: input.provider,
    bindingKey: input.bindingKey,
    externalChatId: input.externalChatId,
    meta: {
      ...bindingMeta,
      lifecycle: {
        ...(bindingMeta.lifecycle as Record<string, unknown>),
        initializedAt: new Date(input.event.timestamp).toISOString(),
        initializedFromEventId: input.event.eventId,
        lastMaterializedBy: input.event.eventType === "conversation_create" ? "conversation_create" : "message_create",
      },
    },
  });

  return binding;
}

/**
 * 处理网关发来的入站事件
 */
export async function handleInboundEvent(event: GatewayInboundEvent) {
  const [rc] = await db
    .select()
    .from(runtimeChannels)
    .where(eq(runtimeChannels.id, event.channelId))
    .limit(1);

  if (!rc) {
    console.warn(`[Channels] Received inbound event for unknown runtime-channel: ${event.channelId}`);
    return;
  }

  const conversationId = event.conversation?.id?.trim() || event.externalChatId;
  const existingInboundRef = await getProviderMessageRef({
    provider: event.provider,
    externalConversationId: conversationId,
    externalMessageId: event.externalMessageId,
    direction: "inbound",
  });

  if (existingInboundRef) {
    console.log(
      `[Channels] Duplicate inbound ignored provider=${event.provider} conversation=${conversationId} message=${event.externalMessageId}`,
    );
    return;
  }

  const bindingKey =
    event.bindingKey?.trim() ||
    `${event.provider}:conversation:${conversationId}`;

  const binding = await resolveOrCreateSessionBindingForEvent({
    runtimeId: rc.runtimeId,
    runtimeChannelId: rc.id,
    provider: event.provider,
    externalChatId: event.externalChatId,
    bindingKey,
    event,
  });

  const sessionId = binding.runtimeSessionId;

  if (event.eventType === "conversation_create") {
    return;
  }

  const textBlock = event.content.find((block): block is { type: 'text'; text: string } => block.type === 'text');
  const text = textBlock?.text || "";
  const images = event.content
    .filter((block): block is { type: 'image'; uri: string } => block.type === 'image' && !!block.uri)
    .map((block) => ({ url: block.uri }));

  const userMessage = await createUserMessageNode({
    runtimeSessionId: sessionId,
    text,
    images,
    externalMessageId: event.externalMessageId,
    meta: {
      provider: event.provider,
      externalConversationId: conversationId,
      sender: event.sender,
      eventMessage: event.message ?? null,
      providerMeta: event.meta ?? null,
    },
  });

  await updateRuntimeSessionBindingMeta({
    bindingId: binding.id,
    meta: {
      lifecycle: {
        sourceEventType: event.eventType ?? "message_create",
        precreated:
          ((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.precreated === true,
        createdVia:
          (((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.createdVia as string | undefined) ?? "message_create",
        lastEventAt: new Date(event.timestamp).toISOString(),
        lastEventId: event.eventId,
        lastMaterializedBy: "message_create",
        firstMessageExternalId:
          (((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.firstMessageExternalId as string | undefined) ??
          event.externalMessageId,
      },
    },
  }).catch(console.error);

  await createProviderMessageRef({
    provider: event.provider,
    runtimeId: rc.runtimeId,
    runtimeSessionId: sessionId,
    runtimeChannelId: rc.id,
    sessionMessageId: userMessage.id,
    direction: "inbound",
    externalConversationId: conversationId,
    externalMessageId: event.externalMessageId,
    parentExternalConversationId: event.conversation?.parentId ?? null,
    parentExternalMessageId: event.message?.parentMessageId ?? null,
    externalAuthorId: event.sender.id,
    externalAuthorName: event.sender.name ?? null,
    meta: {
      bindingKey,
      conversation: event.conversation ?? null,
      message: event.message ?? null,
      content: event.content,
      providerMeta: event.meta ?? null,
    },
  });

  await enqueueRuntimePrompt({
    runtimeId: rc.runtimeId,
    sessionId,
    userMessageId: userMessage.id,
    message: { text, images },
    meta: { intent: binding?.meta ? "continue" : "auto", source: `channel:${event.provider}` },
  });
}
