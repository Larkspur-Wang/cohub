import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { ContentBlock, PersistMessageInput, RegisterSessionInput, UpdateSessionInfoInput } from "@cohub/protocol";
import { db } from "./db/index.js";
import {
  providerMessageRefs,
  sessionMessages,
  spaceChannels,
  spaceSessions,
  spaces,
} from "./db/schema-v2.js";
import {
  createStreamingRedisClient,
  getAgentInstanceInputQueueKey,
  getSpaceOutputStreamKey,
  redisCommandClient,
} from "./redis.js";
import type { RedisStreamEntry } from "./redis.js";
import { dispatchOutboundMessage, dispatchRealtimeEventToUsers, getBindingsBySessionId, getReadableUserIdsForSpace, touchSpaceSessionBinding } from "./channels.js";
import { getSpaceSandboxBySpaceId, updateSpaceSandbox } from "./space-sandboxes.js";
import { resolveOrClaimSpaceOwner } from "./agent-ownership.js";

export class SandboxNotReadyError extends Error {
  constructor(message = "space sandbox is not ready") {
    super(message);
    this.name = "SandboxNotReadyError";
  }
}

const deriveMessagePreviewText = (input: { role?: string | null; content: ContentBlock[] }): string => {
  return input.content
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "image":
          return block.source.type === "url" ? [block.source.url] : [];
        case "system_note":
          return [block.text];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

const extractPlainText = (blocks: ContentBlock[]): string => {
  return blocks
    .flatMap((block) => {
      switch (block.type) {
        case "text":
          return [block.text];
        case "thinking":
          return [block.thinking];
        case "image":
          return block.source.type === "url" ? [block.source.url] : [];
        case "tool_use":
          return [`${block.name}(...)`];
        case "tool_result":
          return typeof block.content === "string" ? [block.content] : [];
        case "system_note":
          return [block.text];
        default:
          return [];
      }
    })
    .join("\n")
    .trim();
};

const countToolCallsInContent = (blocks: ContentBlock[]) => blocks.filter((b) => b.type === "tool_use").length;

export const normalizeSpaceEnv = (input: unknown): Array<{ name: string; value: string }> => {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is { name?: unknown; value?: unknown } => Boolean(item) && typeof item === "object")
    .map((item) => ({ name: String(item.name ?? "").trim(), value: String(item.value ?? "") }))
    .filter((item) => item.name.length > 0);
};

export const validateSpaceEnv = (envs: Array<{ name: string; value: string }>) => {
  if (envs.length > 50) throw new Error("extraEnv cannot exceed 50 entries");
  const seen = new Set<string>();
  for (const env of envs) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.name)) throw new Error(`invalid env name: ${env.name}`);
    if (env.name.length > 128) throw new Error(`env name too long: ${env.name}`);
    if (env.value.length > 4000) throw new Error(`env value too long for: ${env.name}`);
    if (seen.has(env.name)) throw new Error(`duplicate env name: ${env.name}`);
    seen.add(env.name);
  }
};

export const getSpaceById = async (spaceId: string) => {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  return space ?? null;
};

export const getSpaceSessionById = async (spaceSessionId: string) => {
  const [session] = await db.select().from(spaceSessions).where(eq(spaceSessions.id, spaceSessionId)).limit(1);
  return session ?? null;
};

export const createInitialSpaceSession = async (input: RegisterSessionInput) => {
  const [session] = await db.insert(spaceSessions).values({
    id: input.sessionId,
    spaceId: input.spaceId,
    title: input.title ?? null,
    source: input.source ?? null,
    status: "active",
    externalSessionId: input.externalSessionId ?? null,
    meta: input.meta ?? null,
    parentSessionId: null,
    forkedFromMessageId: null,
    lineageRootSessionId: input.sessionId,
    forkDepth: 0,
    lastMessageId: null,
  }).returning();
  if (!session) throw new Error("Failed to create initial space session");
  return session;
};

export const registerSpaceSession = async (input: RegisterSessionInput) => {
  const space = await getSpaceById(input.spaceId);
  if (!space) throw new Error("Space not found");

  try {
    const [session] = await db.insert(spaceSessions).values({
      id: input.sessionId,
      spaceId: input.spaceId,
      title: input.title ?? null,
      source: input.source ?? null,
      status: "active",
      externalSessionId: input.externalSessionId ?? null,
      meta: input.meta ?? null,
      parentSessionId: null,
      forkedFromMessageId: null,
      lineageRootSessionId: input.sessionId,
      forkDepth: 0,
      lastMessageId: null,
    }).returning();
    if (!session) throw new Error("Failed to register space session");
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("duplicate key") || message.includes("already exists") || message.includes("unique")) {
      const [existing] = await db.select().from(spaceSessions).where(eq(spaceSessions.id, input.sessionId)).limit(1);
      if (existing) return existing;
    }
    throw error;
  }
};

export const listSpaceSessions = async (spaceId: string) => {
  return db.select().from(spaceSessions).where(eq(spaceSessions.spaceId, spaceId)).orderBy(
    desc(sql`coalesce(${spaceSessions.lastMessageAt}, ${spaceSessions.createdAt})`),
    desc(spaceSessions.createdAt),
  );
};

export const getSpaceSessionBootstrap = async (spaceSessionId: string) => {
  const session = await getSpaceSessionById(spaceSessionId);
  if (!session) return null;
  return { session, forkSourceProtocolMessageId: session.forkedFromMessageId };
};

const getNextSessionSequence = async (sessionId: string) => {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)::int` }).from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
  return (row?.max ?? 0) + 1;
};

const updateSessionAfterAppend = async (sessionId: string, message: typeof sessionMessages.$inferSelect) => {
  await db.update(spaceSessions).set({
    lastMessageId: message.id,
    latestMessageText: message.text,
    lastMessageAt: message.createdAt ?? new Date(),
    updatedAt: new Date(),
  }).where(eq(spaceSessions.id, sessionId));
};

export const persistMessageNode = async (input: PersistMessageInput & { message: PersistMessageInput["message"] & { id?: string } }) => {
  const [existing] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, input.sessionId), eq(sessionMessages.idempotencyKey, input.idempotencyKey))).limit(1);
  if (existing) return existing;

  const session = await getSpaceSessionById(input.sessionId);
  if (!session || session.spaceId !== input.spaceId) throw new Error("Space session not found");

  if (input.previousMessageId) {
    const [previous] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.id, input.previousMessageId), eq(sessionMessages.sessionId, input.sessionId))).limit(1);
    if (!previous) throw new Error("Previous message not found");
  }

  const sequence = await getNextSessionSequence(input.sessionId);
  const content = input.message.content;
  const text = deriveMessagePreviewText({ role: input.message.role ?? null, content }) || null;
  const messageRole = input.message.role ?? "assistant";
  const shouldDispatchToProvider = messageRole === "assistant";

  if (messageRole === "assistant" && content.length === 0 && !text?.trim()) throw new Error("Refusing to persist empty assistant message");

  let anchorUserMessageId = input.anchorUserMessageId?.trim() || null;
  const toolUseCount = countToolCallsInContent(content);
  const hasError = input.message.errorMessage || input.message.stopReason === "error" || input.message.stopReason === "aborted";
  const messageKind = messageRole !== "assistant" ? messageRole : hasError ? "assistant_error" : (toolUseCount > 0 || input.message.stopReason === "tool_use") ? "assistant_intermediate" : "assistant_final";

  const [messageNode] = await db.insert(sessionMessages).values({
    id: input.message.id?.trim() || undefined,
    sessionId: input.sessionId,
    role: messageRole,
    content,
    text,
    meta: {
      ...((input.message.meta as Record<string, unknown> | null) ?? {}),
      messageKind,
      anchorUserMessageId,
      providerResponseId: ((input.message.meta as Record<string, unknown> | null)?.responseId as string | undefined) ?? null,
    },
    idempotencyKey: input.idempotencyKey,
    sequence,
    provider: input.message.provider ?? null,
    model: input.message.model ?? null,
    stopReason: input.message.stopReason ?? null,
    errorMessage: input.message.errorMessage ?? null,
    usageInput: input.message.usage?.input ?? null,
    usageOutput: input.message.usage?.output ?? null,
    costTotal: input.message.usage?.costTotal !== undefined ? String(input.message.usage.costTotal) : null,
  }).returning();
  if (!messageNode) throw new Error("Failed to persist message");

  if (messageRole === "user" && !session.title?.trim()) {
    const titleText = (text ?? extractPlainText(content)).replace(/\s+/g, " ").replace(/^[:\-\s]+/, "").trim().slice(0, 60);
    if (titleText) {
      await db.update(spaceSessions).set({ title: titleText, updatedAt: new Date() }).where(eq(spaceSessions.id, input.sessionId));
    }
  }

  await updateSessionAfterAppend(input.sessionId, messageNode);

  if (!shouldDispatchToProvider) return messageNode;

  const bindings = await getBindingsBySessionId(session.id);
  if (bindings.length > 0) {
    for (const binding of bindings) {
      await touchSpaceSessionBinding(binding.id).catch(console.error);
      await dispatchOutboundMessage({
        spaceChannelId: binding.spaceChannelId,
        spaceId: session.spaceId,
        spaceSessionId: session.id,
        sessionMessageId: messageNode.id,
        provider: binding.provider,
        externalChatId: binding.externalChatId,
        content: messageNode.content,
        meta: {
          bindingKey: binding.bindingKey,
          sessionMessageRole: messageNode.role,
          editExternalMessageId: null,
          turnAnchorMessageId: anchorUserMessageId ?? messageNode.id,
        },
      }).catch(console.error);
    }
  } else {
    const channels = await db.select().from(spaceChannels).where(eq(spaceChannels.spaceId, session.spaceId));
    for (const channel of channels) {
      await dispatchOutboundMessage({
        spaceChannelId: channel.id,
        spaceId: session.spaceId,
        spaceSessionId: session.id,
        sessionMessageId: messageNode.id,
        content: messageNode.content,
        replyToExternalMessageId: undefined,
        meta: { sessionMessageRole: messageNode.role },
      }).catch(console.error);
    }
  }

  const readableUserIds = await getReadableUserIdsForSpace(session.spaceId).catch(() => [] as string[]);
  await dispatchRealtimeEventToUsers({
    userIds: readableUserIds,
    spaceId: session.spaceId,
    sessionId: session.id,
    sessionMessageId: messageNode.id,
    content: messageNode.content,
    meta: {
      eventType: "session.message",
      sessionMessageRole: messageNode.role,
      messageKind,
      anchorUserMessageId: anchorUserMessageId ?? null,
    },
  }).catch(console.error);

  return messageNode;
};

export const updateSpaceSessionInfo = async (input: UpdateSessionInfoInput) => {
  const session = await getSpaceSessionById(input.sessionId);
  if (!session || session.spaceId !== input.spaceId) throw new Error("Space session not found");
  await db.update(spaceSessions).set({
    title: input.title === undefined ? session.title : (input.title ?? null),
    lastMessageAt: input.updatedAt === undefined ? session.lastMessageAt : input.updatedAt ? new Date(input.updatedAt) : null,
    meta: input.meta === undefined ? session.meta : { ...((session.meta as Record<string, unknown> | null) ?? {}), ...(input.meta ?? {}) },
    updatedAt: new Date(),
  }).where(eq(spaceSessions.id, input.sessionId));
  return true;
};

export const listSessionMessages = async (spaceSessionId: string, options?: { cursor?: number; limit?: number; direction?: "older" | "newer" }) => {
  const limit = Math.min(options?.limit ?? 30, 100);
  const direction = options?.direction ?? "older";
  if (options?.cursor === undefined || options?.cursor === null) {
    const rows = await db.select().from(sessionMessages).where(eq(sessionMessages.sessionId, spaceSessionId)).orderBy(desc(sessionMessages.sequence)).limit(limit);
    return rows.reverse();
  }
  if (direction === "older") {
    const rows = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, spaceSessionId), lt(sessionMessages.sequence, options.cursor))).orderBy(desc(sessionMessages.sequence)).limit(limit);
    return rows.reverse();
  }
  const cursor = options.cursor ?? 0;
  return db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, spaceSessionId), gt(sessionMessages.sequence, cursor))).orderBy(asc(sessionMessages.sequence)).limit(limit);
};

export const forkSpaceSession = async (input: { spaceId: string; parentSessionId: string; fromMessageId: string; newSessionId?: string; title?: string | null }) => {
  const parentSession = await getSpaceSessionById(input.parentSessionId);
  if (!parentSession || parentSession.spaceId !== input.spaceId) throw new Error("Parent space session not found");
  const [fromMessage] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.id, input.fromMessageId), eq(sessionMessages.sessionId, input.parentSessionId))).limit(1);
  if (!fromMessage) throw new Error("Fork source message not found");
  const newSessionId = input.newSessionId ?? randomUUID();
  const lineageRootSessionId = parentSession.lineageRootSessionId ?? parentSession.id;

  const [childSession] = await db.insert(spaceSessions).values({
    id: newSessionId,
    spaceId: input.spaceId,
    title: input.title ?? parentSession.title ?? null,
    status: "active",
    externalSessionId: null,
    meta: { forked: true, fromSessionId: parentSession.id, fromMessageId: fromMessage.id },
    parentSessionId: parentSession.id,
    forkedFromMessageId: fromMessage.id,
    lineageRootSessionId,
    forkDepth: (parentSession.forkDepth ?? 0) + 1,
    lastMessageId: null,
  }).returning();
  if (!childSession) throw new Error("Failed to create forked session");

  const sourceMessages = await db.select().from(sessionMessages).where(eq(sessionMessages.sessionId, parentSession.id)).orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));
  const messagesToCopy = sourceMessages.filter((message) => message.sequence <= fromMessage.sequence);
  for (const message of messagesToCopy) {
    await db.insert(sessionMessages).values({
      sessionId: childSession.id,
      role: message.role,
      content: message.content,
      text: message.text,
      meta: message.meta,
      idempotencyKey: null,
      sequence: message.sequence,
      provider: message.provider,
      model: message.model,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
      usageInput: message.usageInput,
      usageOutput: message.usageOutput,
      costTotal: message.costTotal,
    });
  }

  const copiedMessages = await listSessionMessages(childSession.id);
  const lastMessage = copiedMessages.at(-1) ?? null;
  await db.update(spaceSessions).set({
    lastMessageId: lastMessage?.id ?? null,
    latestMessageText: lastMessage?.text ?? null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    updatedAt: new Date(),
  }).where(eq(spaceSessions.id, childSession.id));

  return (await getSpaceSessionById(childSession.id)) ?? childSession;
};

export const enqueueSpacePrompt = async (input: { spaceId: string; sessionId: string; userMessageId?: string | null; content: ContentBlock[]; meta?: Record<string, unknown> | null }) => {
  const sandbox = await getSpaceSandboxBySpaceId(input.spaceId);
  if (!sandbox || sandbox.status !== "ready") throw new SandboxNotReadyError();

  const lease = await resolveOrClaimSpaceOwner(input.spaceId);

  await redisCommandClient.rpush(
    getAgentInstanceInputQueueKey(lease.ownerId),
    JSON.stringify({
      action: "prompt",
      id: randomUUID(),
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      userMessageId: input.userMessageId ?? null,
      content: input.content,
      meta: input.meta ?? null,
      timestamp: new Date().toISOString(),
      expectedOwnerId: lease.ownerId,
      expectedEpoch: lease.epoch,
    }),
  );
};

export const readSpaceOutputStream = async (input: { spaceId: string; lastEventId?: string; blockMs?: number; signal?: AbortSignal }) => {
  const streamKey = getSpaceOutputStreamKey(input.spaceId);
  const startId = input.lastEventId?.trim() || "$";
  const blockMs = input.blockMs ?? 15000;
  const client = createStreamingRedisClient();
  await client.connect().catch(() => undefined);
  let currentId = startId;

  const close = async () => {
    await client.quit().catch(async () => {
      await client.disconnect();
    });
  };

  const iterator = (async function* () {
    try {
      while (!input.signal?.aborted) {
        const response = await client.xread("BLOCK", blockMs, "STREAMS", streamKey, currentId);
        if (!response) continue;
        for (const [, entries] of response as Array<[string, RedisStreamEntry[]]>) {
          for (const [id, fields] of entries) {
            currentId = id;
            const payloadIndex = fields.findIndex((field) => field === "payload");
            const payload = payloadIndex >= 0 ? fields[payloadIndex + 1] : null;
            yield { id, payload };
          }
        }
      }
    } finally {
      await close();
    }
  })();

  return iterator;
};

export const waitForSpaceReady = async (spaceId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sandbox = await getSpaceSandboxBySpaceId(spaceId);
    if (!sandbox) return false;
    if (sandbox.status === "ready") return true;
    if (sandbox.status === "error") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};

export const updateSpaceStatus = async (spaceId: string, status: string) => {
  const normalizedStatus =
    status === "running" || status === "ready"
      ? "ready"
      : status === "starting" || status === "provisioning"
        ? "provisioning"
        : status === "hibernated" || status === "stopped"
          ? "stopped"
          : status === "deleted" || status === "terminated"
            ? "terminated"
            : status === "error"
              ? "error"
              : "pending";

  const sandbox = await getSpaceSandboxBySpaceId(spaceId);
  await updateSpaceSandbox({
    spaceId,
    status: normalizedStatus,
    podName: normalizedStatus === "terminated" ? null : `sandbox-${spaceId}`,
    lastHeartbeatAt: normalizedStatus === "ready" || normalizedStatus === "provisioning" ? new Date() : undefined,
    meta: {
      ...((sandbox?.meta as Record<string, unknown> | null) ?? {}),
      lastStatus: status,
    },
  });
};

