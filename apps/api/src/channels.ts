import { createLogger } from "@cohub/infra/logging";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { ContentBlock } from "@cohub/protocol/core";
import type { ChannelConfig, ChannelProvider, GatewayChannelCommandEvent, GatewayInboundEvent, GatewayOutboundCommand } from "@cohub/protocol/gateway";
import type { RealtimeServerEvent } from "@cohub/protocol/realtime";
import { executeChannelCommand } from "./channel-commands.js";
import { db } from "./db/index.js";
import { providerMessageRefs, spaceChannels, spaceSessionBindings, userChannels, spaces, spaceMembers } from "@cohub/db";
import { GATEWAY_OUTBOUND_STREAM, REALTIME_OUTBOUND_CHANNEL, getSpaceWsUsersKey, getSpaceWsUsersUpdatedAtKey, redisCommandClient, xaddWithMaxlen } from "./redis.js";
import { registerSpaceSession } from "./space-sessions.js";
import {
  executeSessionInteraction,
  extractInboundText,
} from "./session-interactions.js";
import { hasPermission } from "./permissions.js";
import { buildSessionSourceChannel } from "./lib/session-source-channel.js";
import { assignSessionSourceSystemLabel } from "@cohub/core/labels/session-source";
import { dispatchLabelAssignmentsUpdated } from "./realtime-events.js";


const logger = createLogger({ serviceName: "cohub-api" });
const bindingLocks = new Map<string, Promise<unknown>>();
const GATEWAY_NODE_TTL_MS = 15_000;
const READABLE_USER_IDS_CACHE_TTL_MS = 4_000;
const READABLE_USER_IDS_CACHE_MAX_SIZE = 10_000;
const readableUserIdsCache = new Map<string, { expiresAt: number; value: string[] }>();

type ResolvedChannelInbound = {
  spaceId: string;
  spaceChannelId: string;
  userId: string;
  sessionId: string;
  binding: typeof spaceSessionBindings.$inferSelect;
  conversationId: string;
  bindingKey: string;
};

export function resolveInboundBindingKey(event: GatewayInboundEvent, conversationId = event.conversation?.id?.trim() || event.externalChatId) {
  return event.binding?.key?.trim() || event.bindingKey?.trim() || `${event.provider}:conversation:${conversationId}`;
}

export function resolveInboundParentBindingKey(event: GatewayInboundEvent) {
  return event.binding?.parentKey?.trim() || null;
}

function setReadableUserIdsCache(spaceId: string, value: string[]) {
  if (READABLE_USER_IDS_CACHE_TTL_MS <= 0) return;
  if (readableUserIdsCache.size >= READABLE_USER_IDS_CACHE_MAX_SIZE && !readableUserIdsCache.has(spaceId)) {
    const firstKey = readableUserIdsCache.keys().next().value;
    if (firstKey) readableUserIdsCache.delete(firstKey);
  }
  readableUserIdsCache.set(spaceId, { expiresAt: Date.now() + READABLE_USER_IDS_CACHE_TTL_MS, value });
}

async function pruneStaleGatewayNodes() {
  const staleBefore = Date.now() - GATEWAY_NODE_TTL_MS;
  await redisCommandClient.zremrangebyscore("gateway:nodes", 0, staleBefore);
}

function scoreGatewayNode(channelId: string, nodeId: string) {
  return createHash("sha256").update(`${channelId}:${nodeId}`).digest().readBigUInt64BE(0);
}

async function pickGatewayNode(channelId: string): Promise<string> {
  const now = Date.now();
  await pruneStaleGatewayNodes();
  const activeNodes = await redisCommandClient.zrangebyscore("gateway:nodes", now - GATEWAY_NODE_TTL_MS, "+inf");
  if (activeNodes.length === 0) throw new Error("No active gateway nodes available");

  let selectedNodeId = activeNodes[0];
  let selectedScore = selectedNodeId ? scoreGatewayNode(channelId, selectedNodeId) : -1n;
  for (const nodeId of activeNodes.slice(1)) {
    const score = scoreGatewayNode(channelId, nodeId);
    if (score > selectedScore) {
      selectedNodeId = nodeId;
      selectedScore = score;
    }
  }

  if (!selectedNodeId) throw new Error("Failed to pick gateway node");
  return selectedNodeId;
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
  if (channels.length === 0) return;

  // Batch fetch all user channels in a single query
  const channelIds = channels.map((ch) => ch.channelId);
  const userChannelRows = await db
    .select()
    .from(userChannels)
    .where(inArray(userChannels.id, channelIds));
  const userChannelMap = new Map(userChannelRows.map((uc) => [uc.id, uc]));

  for (const channel of channels) {
    await bindSingleChannelToGateway(channel, userChannelMap.get(channel.channelId));
  }
}

export async function bindAllActiveSpaceChannelsToGateway() {
  const channels = await db.select().from(spaceChannels);
  if (channels.length === 0) return { total: 0, bound: 0, skipped: 0, failed: 0 };

  const channelIds = Array.from(new Set(channels.map((ch) => ch.channelId)));
  const userChannelRows = await db
    .select()
    .from(userChannels)
    .where(inArray(userChannels.id, channelIds));
  const userChannelMap = new Map(userChannelRows.map((uc) => [uc.id, uc]));

  const stats = { total: channels.length, bound: 0, skipped: 0, failed: 0 };
  for (const channel of channels) {
    const userChannel = userChannelMap.get(channel.channelId);
    if (userChannel?.status !== "active") {
      stats.skipped += 1;
      continue;
    }

    try {
      await bindSingleChannelToGateway(channel, userChannel);
      stats.bound += 1;
    } catch (error) {
      stats.failed += 1;
      logger.warn(`[GatewayBinding] failed to bind space channel ${channel.id}:`, error);
    }
  }

  return stats;
}

async function bindSingleChannelToGateway(spaceChannel: typeof spaceChannels.$inferSelect, userChannel: typeof userChannels.$inferSelect | undefined) {
  if (userChannel?.status !== "active") return;

  const existingNodeId = await redisCommandClient.hget("gateway:channel_routing", spaceChannel.id);
  let nodeId = existingNodeId;
  let staleNodeId: string | null = null;

  if (existingNodeId) {
    const nodeLastHeartbeatStr = await redisCommandClient.zscore("gateway:nodes", existingNodeId);
    const nodeLastHeartbeat = typeof nodeLastHeartbeatStr === "string" ? Number.parseFloat(nodeLastHeartbeatStr) : null;
    const isExistingNodeAlive = Boolean(nodeLastHeartbeat && Date.now() - nodeLastHeartbeat < GATEWAY_NODE_TTL_MS);

    if (!isExistingNodeAlive) {
      staleNodeId = existingNodeId;
      nodeId = await pickGatewayNode(spaceChannel.id);
    }
  } else {
    nodeId = await pickGatewayNode(spaceChannel.id);
  }

  if (!nodeId) {
    throw new Error(`Failed to resolve gateway node for space channel ${spaceChannel.id}`);
  }

  const serializedTask = JSON.stringify({
    channelId: spaceChannel.id,
    provider: userChannel.provider,
    credentials: userChannel.credentials,
  });

  const pipeline = redisCommandClient.multi()
    .set(
      getSpaceChannelConfigKey(spaceChannel.id),
      JSON.stringify((spaceChannel.config as ChannelConfig | Record<string, unknown> | null) ?? {}),
    )
    .hset(`gateway:node:${nodeId}:channels`, spaceChannel.id, serializedTask)
    .hset("gateway:channel_routing", spaceChannel.id, nodeId);

  if (staleNodeId && staleNodeId !== nodeId) {
    pipeline.hdel(`gateway:node:${staleNodeId}:channels`, spaceChannel.id);
  }

  await pipeline.exec();
}

export async function unbindSpaceChannelFromGateway(spaceChannelId: string) {
  const nodeId = await redisCommandClient.hget("gateway:channel_routing", spaceChannelId);
  if (!nodeId) return;

  // Remove from gateway node's channel list
  await redisCommandClient.hdel(`gateway:node:${nodeId}:channels`, spaceChannelId);
  // Remove from global routing table
  await redisCommandClient.hdel("gateway:channel_routing", spaceChannelId);
  // Clear config cache
  await redisCommandClient.del(getSpaceChannelConfigKey(spaceChannelId));
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
  const { targetUserIds: rawTargetUserIds, targetConnectionId, ...cleanPayload } = input.payload as RealtimeServerEvent["payload"] & { targetUserIds?: string[]; targetConnectionId?: string | null };
  let targetUserIds = Array.from(new Set((rawTargetUserIds ?? []).map((value) => value.trim()).filter(Boolean)));
  const hasExplicitTarget = targetUserIds.length > 0 || Boolean(targetConnectionId);
  if (input.spaceId && !hasExplicitTarget) {
    targetUserIds = await recomputeSpaceWsUsers(input.spaceId).catch((error) => {
      logger.warn(`[RealtimeAudience] failed to refresh ws users for ${input.spaceId}:`, error);
      return targetUserIds;
    });
  }

  await redisCommandClient.publish(
    REALTIME_OUTBOUND_CHANNEL,
    JSON.stringify({
      ...input,
      payload: targetConnectionId
        ? { ...cleanPayload, targetConnectionId }
        : targetUserIds.length > 0
          ? { ...cleanPayload, targetUserIds }
          : cleanPayload,
    }),
  );
}

export async function getReadableUserIdsForSpace(spaceId: string) {
  const now = Date.now();
  const cached = readableUserIdsCache.get(spaceId);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) readableUserIdsCache.delete(spaceId);

  const [space] = await db.select({ ownerId: spaces.userUuid }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const members = await db
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId));
  const userIds = new Set<string>();
  if (space?.ownerId) userIds.add(space.ownerId);
  for (const member of members) {
    if (member.userId) userIds.add(member.userId);
  }
  const result = Array.from(userIds);
  setReadableUserIdsCache(spaceId, result);
  return result;
}

export async function recomputeSpaceWsUsers(spaceId: string, userIds?: string[]) {
  const readableUserIds = userIds ?? await getReadableUserIdsForSpace(spaceId);
  const key = getSpaceWsUsersKey(spaceId);
  const pipeline = redisCommandClient.pipeline();
  pipeline.del(key);
  if (readableUserIds.length > 0) pipeline.sadd(key, ...readableUserIds);
  pipeline.set(getSpaceWsUsersUpdatedAtKey(spaceId), String(Date.now()));
  await pipeline.exec();
  return readableUserIds;
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

export async function getProviderMessageRefBySessionMessage(input: { spaceChannelId: string; sessionMessageId: string; direction?: "inbound" | "outbound" }) {
  const [ref] = await db.select().from(providerMessageRefs).where(
    input.direction
      ? and(eq(providerMessageRefs.spaceChannelId, input.spaceChannelId), eq(providerMessageRefs.sessionMessageId, input.sessionMessageId), eq(providerMessageRefs.direction, input.direction))
      : and(eq(providerMessageRefs.spaceChannelId, input.spaceChannelId), eq(providerMessageRefs.sessionMessageId, input.sessionMessageId)),
  ).orderBy(desc(providerMessageRefs.createdAt)).limit(1);
  return ref ?? null;
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
  } as Record<string, unknown>;
}

async function _resolveOrCreateSessionBindingForEvent(input: { spaceId: string; spaceChannelId: string; userUuid: string; provider: string; externalChatId: string; bindingKey: string; event: GatewayInboundEvent }) {
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

async function resolveOrCreateSessionBindingForEventImpl(input: { spaceId: string; spaceChannelId: string; userUuid: string; provider: string; externalChatId: string; bindingKey: string; event: GatewayInboundEvent }) {
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
    await updateSpaceSessionBindingMeta({ bindingId: binding.id, meta: lifecycleUpdate }).catch((error) => logger.error("[Channels] failed to update session binding lifecycle meta", error));
    await touchSpaceSessionBinding(binding.id);
    return binding;
  }

  const sessionSource = buildSessionSourceChannel(input.event);
  const session = await registerSpaceSession({
        spaceId: input.spaceId,
        sessionId: randomUUID(),
        userUuid: input.userUuid,
        source: sessionSource,
        externalSessionId: null,
        meta: {
          source: input.provider,
          createdFrom: input.event.eventType === "conversation_create" ? "gateway_conversation_create" : "gateway_inbound",
          conversation: input.event.conversation ?? null,
          providerMeta: input.event.meta ?? null,
        },
      });

  await assignSessionSourceSystemLabel({
    db,
    spaceId: input.spaceId,
    sessionId: session.id,
    source: sessionSource,
    provider: input.provider,
  }).then(() =>
    dispatchLabelAssignmentsUpdated({ spaceId: input.spaceId, resourceType: "session", resourceRef: session.id, sessionId: session.id }),
  ).catch((error) => logger.warn("[SessionSourceLabel] failed to assign channel source label", error));

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

export async function resolveChannelInboundForEvent(event: GatewayInboundEvent): Promise<ResolvedChannelInbound | null> {
  const [spaceChannel] = await db.select().from(spaceChannels).where(eq(spaceChannels.id, event.channelId)).limit(1);
  if (!spaceChannel) return null;
  const [userChannel] = await db.select({ userUuid: userChannels.userUuid }).from(userChannels).where(eq(userChannels.id, spaceChannel.channelId)).limit(1);
  if (!userChannel) return null;

  const conversationId = event.conversation?.id?.trim() || event.externalChatId;
  const existingInboundRef = await getProviderMessageRef({
    provider: event.provider,
    externalConversationId: conversationId,
    externalMessageId: event.externalMessageId,
    direction: "inbound",
  });
  if (existingInboundRef) return null;

  const bindingKey = resolveInboundBindingKey(event, conversationId);
  const binding = await _resolveOrCreateSessionBindingForEvent({
    spaceId: spaceChannel.spaceId,
    userUuid: userChannel.userUuid,
    spaceChannelId: spaceChannel.id,
    provider: event.provider,
    externalChatId: event.externalChatId,
    bindingKey,
    event,
  });

  return {
    spaceId: spaceChannel.spaceId,
    spaceChannelId: spaceChannel.id,
    userId: userChannel.userUuid,
    sessionId: binding.spaceSessionId,
    binding,
    conversationId,
    bindingKey,
  };
}

async function handleChannelCommandInboundEvent(event: GatewayChannelCommandEvent) {
  const resolved = await resolveChannelInboundForEvent(event);
  if (!resolved) return;
  await executeChannelCommand({
    event,
    resolved,
    command: event.command,
    deps: {
      buildDefaultBindingMeta,
      createProviderMessageRef,
      createSpaceSessionBinding,
      dispatchOutboundMessage,
    },
  });
}

async function handleConversationCreateInboundEvent(event: GatewayInboundEvent) {
  await resolveChannelInboundForEvent(event);
}

async function handleMessageCreateInboundEvent(event: GatewayInboundEvent) {
  const resolved = await resolveChannelInboundForEvent(event);
  if (!resolved) return;

  const canChannelOwnerWrite = await hasPermission({ uuid: resolved.userId }, "session.prompt.fullaccess", {
    spaceId: resolved.spaceId,
    sessionId: resolved.sessionId,
  });
  if (!canChannelOwnerWrite) return;

  await executeSessionInteraction({
    spaceId: resolved.spaceId,
    sessionId: resolved.sessionId,
    inputText: extractInboundText(event),
    content: event.content,
    source: event.provider,
    userId: resolved.userId,
    clientMessageId: event.externalMessageId,
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

export async function handleInboundEvent(event: GatewayInboundEvent) {
  switch (event.eventType) {
    case "channel_command":
      await handleChannelCommandInboundEvent(event);
      return;
    case "conversation_create":
      await handleConversationCreateInboundEvent(event);
      return;
    case "message_create":
      await handleMessageCreateInboundEvent(event);
      return;
  }
}
