import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { ChannelConfig, ChannelProvider, ContentBlock, GatewayInboundEvent, GatewayOutboundCommand, RealtimeServerEvent } from "@cohub/protocol";
import { buildSessionSourceChannel } from "@cohub/protocol";
import { db } from "./db/index.js";
import { providerMessageRefs, spaceChannels, spaceSessionBindings, userChannels, resourcePermissions, spaces, spaceSessions } from "./db/schema-v2.js";
import { GATEWAY_OUTBOUND_STREAM, GATEWAY_WS_BROADCAST_CHANNEL, redisCommandClient, xaddWithMaxlen } from "./redis.js";
import { forkSpaceSession, registerSpaceSession } from "./space-sessions.js";
import {
  executeSessionInteraction,
  extractInboundText,
  resolveSessionInteractionForInboundEvent,
  type ResolvedInboundInteraction,
} from "./session-interactions.js";

const bindingLocks = new Map<string, Promise<unknown>>();

async function pickGatewayNode(): Promise<string> {
  const now = Date.now();
  const activeNodes = await redisCommandClient.zrangebyscore("gateway:nodes", now - 15000, "+inf");
  if (activeNodes.length === 0) throw new Error("No active gateway nodes available");
  const nodeId = activeNodes[Math.floor(Math.random() * activeNodes.length)];
  if (!nodeId) throw new Error("Failed to pick gateway node");
  return nodeId;
}

const getSpaceChannelConfigKey = (spaceChannelId: string) => `gateway:space_channel_config:${spaceChannelId}`;

export async function syncSpaceChannelConfigCache(input: { spaceChannelId: string; config: ChannelConfig | Record<string, unknown> | null }) {
  await redisCommandClient.set(getSpaceChannelConfigKey(input.spaceChannelId), JSON.stringify(input.config ?? {}));
}

export async function getSpaceChannelRecord(spaceChannelId: string) {
  const [channel] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, spaceChannelId)).limit(1);
  return channel ?? null;
}

export async function bindSpaceChannelsToGateway(spaceId: string) {
  const channels = await db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, spaceId));
  for (const channel of channels) {
    const [userChannel] = await db.select().from(userChannels).where(eq(userChannels.id, channel.channelId)).limit(1);
    if (!userChannel || userChannel.status !== "active") continue;

    const existingNodeId = await redisCommandClient.hget("gateway:channel_routing", channel.id);
    if (existingNodeId) {
      const nodeLastHeartbeatStr = await redisCommandClient.zscore("gateway:nodes", existingNodeId);
      const nodeLastHeartbeat = typeof nodeLastHeartbeatStr === "string" ? Number.parseFloat(nodeLastHeartbeatStr) : null;
      if (nodeLastHeartbeat && Date.now() - nodeLastHeartbeat < 15000) continue;
    }

    const nodeId = await pickGatewayNode();
    await syncSpaceChannelConfigCache({ spaceChannelId: channel.id, config: (channel.config as ChannelConfig | Record<string, unknown> | null) ?? null });
    await redisCommandClient.hset(`gateway:node:${nodeId}:channels`, channel.id, JSON.stringify({
      channelId: channel.id,
      provider: userChannel.provider,
      credentials: userChannel.credentials,
    }));
    await redisCommandClient.hset("gateway:channel_routing", channel.id, nodeId);
  }
}

export async function dispatchOutboundMessage(input: {
  spaceChannelId: string;
  spaceId?: string;
  spaceSessionId?: string;
  sessionMessageId?: string;
  provider?: string;
  externalChatId?: string | null;
  content: ContentBlock[];
  replyToExternalMessageId?: string;
  meta?: Record<string, unknown> | null;
}) {
  const nodeId = await redisCommandClient.hget("gateway:channel_routing", input.spaceChannelId);
  if (!nodeId) return;

  const [spaceChannel] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, input.spaceChannelId)).limit(1);
  if (!spaceChannel) return;

  const [userChannel] = await db.select().from(userChannels).where(eq(userChannels.id, spaceChannel.channelId)).limit(1);
  if (!userChannel) return;

  const externalChatId = input.externalChatId?.trim();
  if (!externalChatId) return;

  const command: GatewayOutboundCommand = {
    commandId: randomUUID(),
    timestamp: Date.now(),
    channelId: spaceChannel.id,
    provider: (input.provider ?? userChannel.provider) as ChannelProvider,
    externalChatId,
    content: input.content,
    replyToExternalMessageId: input.replyToExternalMessageId,
    spaceId: input.spaceId ?? spaceChannel.spaceId,
    spaceSessionId: input.spaceSessionId,
    sessionMessageId: input.sessionMessageId,
    meta: input.meta ?? null,
  };

  await xaddWithMaxlen(redisCommandClient, GATEWAY_OUTBOUND_STREAM, "*", "payload", JSON.stringify(command));
}

export async function dispatchRealtimeEventToUsers(input: RealtimeServerEvent & { payload: RealtimeServerEvent["payload"] & { targetUserIds?: string[]; targetConnectionId?: string | null } }) {
  const targetUserIds = Array.from(new Set((input.payload.targetUserIds ?? []).map((value) => value.trim()).filter(Boolean)));
  if (targetUserIds.length === 0 && !input.payload.targetConnectionId) return;

  await redisCommandClient.publish(
    GATEWAY_WS_BROADCAST_CHANNEL,
    JSON.stringify({
      ...input,
      payload: {
        ...input.payload,
        targetUserIds,
      },
    }),
  );
}

export async function getReadableUserIdsForSpace(spaceId: string) {
  const [space] = await db.select({ ownerId: spaces.userUuid }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const permissions = await db.select({ granteeUuid: resourcePermissions.granteeUuid }).from(resourcePermissions).where(and(eq(resourcePermissions.resourceType, "space"), eq(resourcePermissions.resourceId, spaceId), inArray(resourcePermissions.level, ["read", "write"])));
  const userIds = new Set<string>();
  if (space?.ownerId) userIds.add(space.ownerId);
  for (const permission of permissions) {
    if (permission.granteeUuid) userIds.add(permission.granteeUuid);
  }
  return Array.from(userIds);
}

type DirectWebsocketInboundContext = {
  token: string;
  userId: string;
  spaceId: string;
  sessionId: string;
  connectionId: string;
  requestId: string;
  clientMessageId: string | null;
};

function resolveDirectWebsocketInboundContext(event: GatewayInboundEvent): DirectWebsocketInboundContext | null {
  const token = typeof event.meta?.authToken === "string" ? event.meta.authToken.trim() : "";
  const userId = typeof event.meta?.userId === "string" ? event.meta.userId.trim() : event.sender.id;
  const spaceId = typeof event.meta?.spaceId === "string" ? event.meta.spaceId.trim() : "";
  const sessionId = typeof event.meta?.sessionId === "string"
    ? event.meta.sessionId.trim()
    : event.conversation?.id?.trim() || event.externalChatId;
  const connectionId = typeof event.meta?.connectionId === "string" ? event.meta.connectionId.trim() : "";
  const requestId = typeof event.meta?.requestId === "string" ? event.meta.requestId.trim() : "";
  const clientMessageId = typeof event.meta?.clientMessageId === "string" && event.meta.clientMessageId.trim()
    ? event.meta.clientMessageId.trim()
    : null;

  if (!spaceId || !sessionId || !userId || !token) return null;
  return { token, userId, spaceId, sessionId, connectionId, requestId, clientMessageId };
}

async function buildDirectWebsocketInteraction(event: GatewayInboundEvent): Promise<ResolvedInboundInteraction | null> {
  const context = resolveDirectWebsocketInboundContext(event);
  if (!context) return null;

  const existingInboundRef = context.clientMessageId
    ? await getProviderMessageRef({
        provider: event.provider,
        externalConversationId: context.sessionId,
        externalMessageId: context.clientMessageId,
        direction: "inbound",
      })
    : null;
  if (existingInboundRef) return null;

  return {
    spaceId: context.spaceId,
    sessionId: context.sessionId,
    inputText: extractInboundText(event),
    content: event.content,
    source: "channel:websocket",
    interactionId: event.eventId,
    actorUserId: context.userId,
    model: typeof event.meta?.model === "string" && event.meta.model.trim() ? event.meta.model.trim() : undefined,
    provider: typeof event.meta?.provider === "string" && event.meta.provider.trim() ? event.meta.provider.trim() : undefined,
    inboundRef: {
      provider: event.provider,
      spaceChannelId: context.sessionId,
      externalConversationId: context.sessionId,
      externalMessageId: event.externalMessageId,
      externalAuthorId: context.userId,
      externalAuthorName: event.sender.name ?? null,
      meta: {
        requestId: context.requestId || null,
        connectionId: context.connectionId || null,
        clientMessageId: context.clientMessageId,
      },
    },
  };
}

export async function handleWebsocketInboundEvent(event: GatewayInboundEvent) {
  const context = resolveDirectWebsocketInboundContext(event);

  if (!context) {
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "system",
      type: "system.request.error",
      requestId: (typeof event.meta?.requestId === "string" ? event.meta.requestId.trim() : "") || null,
      spaceId: (typeof event.meta?.spaceId === "string" ? event.meta.spaceId.trim() : "") || null,
      sessionId: (typeof event.meta?.sessionId === "string" ? event.meta.sessionId.trim() : event.conversation?.id?.trim() || event.externalChatId) || null,
      payload: {
        code: "BAD_REQUEST",
        message: "invalid websocket message context",
        targetConnectionId: (typeof event.meta?.connectionId === "string" ? event.meta.connectionId.trim() : "") || null,
        targetUserIds: typeof event.meta?.userId === "string" && event.meta.userId.trim() ? [event.meta.userId.trim()] : [],
      },
    });
    return;
  }

  const { userId, spaceId, sessionId, connectionId, requestId } = context;

  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const [session] = await db.select().from(spaceSessions).where(eq(spaceSessions.id, sessionId)).limit(1);
  if (!space || !session || session.spaceId !== spaceId) {
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "session",
      type: "session.request.error",
      requestId: requestId || null,
      spaceId,
      sessionId,
      payload: {
        code: "NOT_FOUND",
        message: "space or session not found",
        targetConnectionId: connectionId || null,
        targetUserIds: [userId],
      },
    });
    return;
  }

  const writePermissionRows = await db.select({
    resourceType: resourcePermissions.resourceType,
  }).from(resourcePermissions).where(
    and(
      inArray(resourcePermissions.resourceType, ["space", "session"]),
      inArray(resourcePermissions.resourceId, [spaceId, sessionId]),
      eq(resourcePermissions.granteeUuid, userId),
      eq(resourcePermissions.level, "write"),
    ),
  );

  const canUserWrite = space.userUuid === userId || writePermissionRows.length > 0;

  if (!canUserWrite) {
    await dispatchRealtimeEventToUsers({
      id: randomUUID(),
      timestamp: Date.now(),
      domain: "session",
      type: "session.request.error",
      requestId: requestId || null,
      spaceId,
      sessionId,
      payload: {
        code: "FORBIDDEN",
        message: "no write permission for session",
        targetConnectionId: connectionId || null,
        targetUserIds: [userId],
      },
    });
    return;
  }

  const interaction = await buildDirectWebsocketInteraction(event);
  if (!interaction) return;
  await executeSessionInteraction(interaction);
}

export async function getBindingBySpaceChannelAndKey(input: { spaceChannelId: string; bindingKey: string }) {
  const [binding] = await db.select().from(spaceSessionBindings).where(and(eq(spaceSessionBindings.spaceChannelId, input.spaceChannelId), eq(spaceSessionBindings.bindingKey, input.bindingKey))).limit(1);
  return binding ?? null;
}

export async function getBindingsBySpaceId(spaceId: string) {
  return db.select().from(spaceSessionBindings).where(eq(spaceSessionBindings.spaceId, spaceId));
}

export async function getSpaceChannelsBySpaceId(spaceId: string) {
  return db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, spaceId));
}

export async function getSpaceChannelById(spaceChannelId: string) {
  const [spaceChannel] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, spaceChannelId)).limit(1);
  return spaceChannel ?? null;
}

export async function updateSpaceChannelConfig(input: { spaceChannelId: string; config: Record<string, unknown> | null }) {
  const [updated] = await db.update(spaceChannels).set({ config: input.config ?? null }).where(eq(spaceChannels.id, input.spaceChannelId)).returning();
  if (!updated) return null;
  await syncSpaceChannelConfigCache({ spaceChannelId: updated.id, config: (updated.config as Record<string, unknown> | null) ?? null });
  return updated;
}

export async function getBindingsBySessionId(spaceSessionId: string) {
  return db.select().from(spaceSessionBindings).where(eq(spaceSessionBindings.spaceSessionId, spaceSessionId));
}

export async function getBindingBySessionId(spaceSessionId: string) {
  const [binding] = await getBindingsBySessionId(spaceSessionId);
  return binding ?? null;
}

export async function createSpaceSessionBinding(input: {
  spaceId: string;
  spaceSessionId: string;
  spaceChannelId: string;
  provider: string;
  bindingKey: string;
  externalChatId: string;
  meta?: Record<string, unknown> | null;
}) {
  const [binding] = await db.insert(spaceSessionBindings).values({
    spaceId: input.spaceId,
    spaceSessionId: input.spaceSessionId,
    spaceChannelId: input.spaceChannelId,
    provider: input.provider,
    bindingKey: input.bindingKey,
    externalChatId: input.externalChatId,
    status: "active",
    meta: input.meta ?? null,
    updatedAt: new Date(),
    lastMessageAt: new Date(),
  }).onConflictDoUpdate({
    target: [spaceSessionBindings.spaceChannelId, spaceSessionBindings.bindingKey],
    set: {
      spaceId: input.spaceId,
      spaceSessionId: input.spaceSessionId,
      provider: input.provider,
      externalChatId: input.externalChatId,
      status: "active",
      meta: input.meta ?? null,
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    },
  }).returning();
  if (!binding) throw new Error("Failed to create space session binding");
  return binding;
}

export async function touchSpaceSessionBinding(bindingId: string) {
  await db.update(spaceSessionBindings).set({ updatedAt: new Date(), lastMessageAt: new Date() }).where(eq(spaceSessionBindings.id, bindingId));
}

export async function updateSpaceSessionBindingMeta(input: { bindingId: string; meta: Record<string, unknown> | null }) {
  const [binding] = await db.select().from(spaceSessionBindings).where(eq(spaceSessionBindings.id, input.bindingId)).limit(1);
  if (!binding) return null;
  const mergedMeta = { ...((binding.meta as Record<string, unknown> | null) ?? {}), ...(input.meta ?? {}) };
  const [updated] = await db.update(spaceSessionBindings).set({ meta: mergedMeta, updatedAt: new Date(), lastMessageAt: new Date() }).where(eq(spaceSessionBindings.id, input.bindingId)).returning();
  return updated ?? null;
}

export async function createProviderMessageRef(input: {
  provider: string;
  spaceId: string;
  spaceSessionId: string;
  spaceChannelId?: string | null;
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
  const [ref] = await db.insert(providerMessageRefs).values({
    provider: input.provider,
    spaceId: input.spaceId,
    spaceSessionId: input.spaceSessionId,
    spaceChannelId: input.spaceChannelId ?? null,
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
  }).onConflictDoUpdate({
    target: [providerMessageRefs.provider, providerMessageRefs.externalConversationId, providerMessageRefs.externalMessageId, providerMessageRefs.direction],
    set: {
      spaceId: input.spaceId,
      spaceSessionId: input.spaceSessionId,
      spaceChannelId: input.spaceChannelId ?? null,
      sessionMessageId: input.sessionMessageId ?? null,
      parentExternalConversationId: input.parentExternalConversationId ?? null,
      parentExternalMessageId: input.parentExternalMessageId ?? null,
      externalAuthorId: input.externalAuthorId ?? null,
      externalAuthorName: input.externalAuthorName ?? null,
      meta: input.meta ?? null,
      updatedAt: new Date(),
    },
  }).returning();
  return ref ?? null;
}

export async function getProviderMessageRef(input: { provider: string; externalConversationId: string; externalMessageId: string; direction?: "inbound" | "outbound" }) {
  const [ref] = await db.select().from(providerMessageRefs).where(
    input.direction
      ? and(eq(providerMessageRefs.provider, input.provider), eq(providerMessageRefs.externalConversationId, input.externalConversationId), eq(providerMessageRefs.externalMessageId, input.externalMessageId), eq(providerMessageRefs.direction, input.direction))
      : and(eq(providerMessageRefs.provider, input.provider), eq(providerMessageRefs.externalConversationId, input.externalConversationId), eq(providerMessageRefs.externalMessageId, input.externalMessageId)),
  ).orderBy(desc(providerMessageRefs.createdAt)).limit(1);
  return ref ?? null;
}

export async function resolveForkSourceForInboundEvent(input: { spaceChannelId: string; provider: string; conversationId: string; parentConversationId?: string | null; parentMessageId?: string | null }) {
  const parentConversationId = input.parentConversationId?.trim();
  const parentMessageId = input.parentMessageId?.trim();
  if (!parentConversationId || !parentMessageId) return null;
  const parentBindingKey = `${input.provider}:conversation:${parentConversationId}`;
  const parentBinding = await getBindingBySpaceChannelAndKey({ spaceChannelId: input.spaceChannelId, bindingKey: parentBindingKey });
  if (!parentBinding) return null;
  const anchorRef = await getProviderMessageRef({ provider: input.provider, externalConversationId: parentConversationId, externalMessageId: parentMessageId, direction: "inbound" });
  if (anchorRef?.sessionMessageId && anchorRef.spaceSessionId === parentBinding.spaceSessionId) {
    return { parentSessionId: parentBinding.spaceSessionId, fromMessageId: anchorRef.sessionMessageId };
  }
  const fallbackAnchorRef = await getProviderMessageRef({ provider: input.provider, externalConversationId: parentConversationId, externalMessageId: parentMessageId });
  if (fallbackAnchorRef?.sessionMessageId && fallbackAnchorRef.spaceSessionId === parentBinding.spaceSessionId) {
    return { parentSessionId: parentBinding.spaceSessionId, fromMessageId: fallbackAnchorRef.sessionMessageId };
  }
  return null;
}

export function buildDefaultBindingMeta(event: GatewayInboundEvent) {
  return {
    conversation: event.conversation ?? null,
    message: event.message ?? null,
    providerMeta: event.meta ?? null,
    displayMode: event.conversation?.parentId || (event.conversation?.meta as Record<string, unknown> | null)?.isDm === true ? "compact" : "minimal",
    lifecycle: {
      sourceEventType: event.eventType ?? "message_create",
      precreated: event.eventType === "conversation_create",
      createdVia: event.eventType === "conversation_create" ? "conversation_create" : "message_create",
      lastEventAt: new Date(event.timestamp).toISOString(),
      lastEventId: event.eventId,
    },
    forkedFromExternal: event.conversation?.parentId && event.message?.parentMessageId ? { conversationId: event.conversation.parentId, messageId: event.message.parentMessageId } : null,
  } as Record<string, unknown>;
}

async function resolveOrCreateSessionBindingForEvent(input: { spaceId: string; spaceChannelId: string; provider: string; externalChatId: string; bindingKey: string; event: GatewayInboundEvent }) {
  const lockKey = `${input.spaceChannelId}:${input.bindingKey}`;
  const existingLock = bindingLocks.get(lockKey);
  if (existingLock) {
    await existingLock;
    const existing = await getBindingBySpaceChannelAndKey({ spaceChannelId: input.spaceChannelId, bindingKey: input.bindingKey });
    if (existing?.spaceSessionId) return existing;
  }
  let unlock: (() => void) | undefined;
  const lock = new Promise<void>((resolve) => { unlock = resolve; });
  bindingLocks.set(lockKey, lock);
  try {
    return await resolveOrCreateSessionBindingForEventImpl(input);
  } finally {
    unlock?.();
    bindingLocks.delete(lockKey);
  }
}

async function resolveOrCreateSessionBindingForEventImpl(input: { spaceId: string; spaceChannelId: string; provider: string; externalChatId: string; bindingKey: string; event: GatewayInboundEvent }) {
  let binding = await getBindingBySpaceChannelAndKey({ spaceChannelId: input.spaceChannelId, bindingKey: input.bindingKey });
  if (binding?.spaceSessionId) {
    const lifecycleUpdate = {
      lifecycle: {
        sourceEventType: input.event.eventType ?? "message_create",
        precreated: ((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.precreated === true || input.event.eventType === "conversation_create",
        createdVia: (((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.createdVia as string | undefined) ?? (input.event.eventType === "conversation_create" ? "conversation_create" : "message_create"),
        lastEventAt: new Date(input.event.timestamp).toISOString(),
        lastEventId: input.event.eventId,
        lastMaterializedBy: input.event.eventType === "conversation_create" ? "conversation_create" : ((binding.meta as Record<string, unknown> | null)?.lifecycle as Record<string, unknown> | null)?.lastMaterializedBy ?? "message_create",
      },
    };
    await updateSpaceSessionBindingMeta({ bindingId: binding.id, meta: lifecycleUpdate }).catch(console.error);
    await touchSpaceSessionBinding(binding.id);
    return binding;
  }

  const forkSource = await resolveForkSourceForInboundEvent({
    spaceChannelId: input.spaceChannelId,
    provider: input.provider,
    conversationId: input.event.conversation?.id?.trim() || input.externalChatId,
    parentConversationId: input.event.conversation?.parentId ?? null,
    parentMessageId: input.event.message?.parentMessageId ?? null,
  });

  const sessionSource = buildSessionSourceChannel(input.event);
  const session = forkSource
    ? await forkSpaceSession({ spaceId: input.spaceId, parentSessionId: forkSource.parentSessionId, fromMessageId: forkSource.fromMessageId, newSessionId: randomUUID() })
    : await registerSpaceSession({
        spaceId: input.spaceId,
        sessionId: randomUUID(),
        source: sessionSource,
        externalSessionId: null,
        meta: {
          source: `channel:${input.provider}`,
          createdFrom: input.event.eventType === "conversation_create" ? "gateway_conversation_create" : "gateway_inbound",
          conversation: input.event.conversation ?? null,
          providerMeta: input.event.meta ?? null,
        },
      });

  binding = await createSpaceSessionBinding({
    spaceId: input.spaceId,
    spaceSessionId: session.id,
    spaceChannelId: input.spaceChannelId,
    provider: input.provider,
    bindingKey: input.bindingKey,
    externalChatId: input.externalChatId,
    meta: {
      ...buildDefaultBindingMeta(input.event),
      lifecycle: {
        ...(buildDefaultBindingMeta(input.event).lifecycle as Record<string, unknown>),
        initializedAt: new Date(input.event.timestamp).toISOString(),
        initializedFromEventId: input.event.eventId,
        lastMaterializedBy: input.event.eventType === "conversation_create" ? "conversation_create" : "message_create",
      },
    },
  });
  return binding;
}

export async function handleInboundEvent(event: GatewayInboundEvent) {
  const resolved = await resolveSessionInteractionForInboundEvent(event);
  if (!resolved || event.eventType === "conversation_create") return;
  await executeSessionInteraction({
    spaceId: resolved.spaceId,
    sessionId: resolved.sessionId,
    inputText: extractInboundText(event),
    content: event.content,
    source: `channel:${event.provider}`,
    interactionId: event.eventId,
    actorUserId: event.sender.id,
    inboundRef: {
      provider: event.provider,
      spaceChannelId: resolved.spaceChannelId,
      externalConversationId: resolved.conversationId,
      externalMessageId: event.externalMessageId,
      externalAuthorId: event.sender.id,
      externalAuthorName: event.sender.name ?? null,
      meta: { bindingKey: resolved.bindingKey },
    },
  });
}
