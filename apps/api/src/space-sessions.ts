import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { ContentBlock, Usage } from "@neta-art/cohub-protocol/core";
import type { PersistMessageInput, RegisterSessionInput, UpdateSessionInfoInput } from "@neta-art/cohub-protocol/model";
import { injectTrace } from "@cohub/tracing/propagator";
import { SPACE_ENV_REDIS_KEY } from "@cohub/agent-sandbox-protocol";
import { db } from "./db/index.js";
import {
  sessionMessages,
  spaceSessions,
  spaces,
  tokenUsageStatsHourly,
} from "./db/schema-v2.js";
import {
  getAgentInstanceInputQueueKey,
  redisCommandClient,
} from "./redis.js";
import { getSpaceSandboxBySpaceId, updateSpaceSandbox } from "./space-sandboxes.js";
import { resolveOrClaimSessionOwner } from "./agent-ownership.js";
import { buildSessionOutputsForPersistedMessage, dispatchSessionOutputs } from "./session-output.js";
import { createExecutionGrant } from "./execution-grants.js";

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
const HISTORY_THINKING_PREVIEW_CHARS = 260;
const HISTORY_TOOL_INPUT_PREVIEW_CHARS = 260;

const truncateText = (text: string, limit: number) => {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, limit - 1))}…`, truncated: true };
};

const summarizeToolInput = (name: string, input: Record<string, unknown>) => {
  if (name === "bash" && typeof input.command === "string") {
    return { command: truncateText(input.command, HISTORY_TOOL_INPUT_PREVIEW_CHARS).text };
  }
  if (["read", "write", "edit"].includes(name) && typeof input.path === "string") {
    return { path: input.path };
  }
  try {
    return { preview: truncateText(JSON.stringify(input), HISTORY_TOOL_INPUT_PREVIEW_CHARS).text };
  } catch {
    return { preview: truncateText(String(input), HISTORY_TOOL_INPUT_PREVIEW_CHARS).text };
  }
};

const getHistorySummary = (content: ContentBlock[]) => ({
  toolCallCount: content.filter((block) => block.type === "tool_use").length,
  thinkingCharCount: content.reduce(
    (sum, block) => sum + (block.type === "thinking" ? block.thinking.length : 0),
    0,
  ),
});

const summarizeContentForDefaultView = (content: ContentBlock[]): ContentBlock[] => {
  return content.map((block) => {
    if (block.type === "thinking") {
      const truncated = block.thinking.length > HISTORY_THINKING_PREVIEW_CHARS
        ? { text: block.thinking.slice(0, HISTORY_THINKING_PREVIEW_CHARS), truncated: true }
        : { text: block.thinking, truncated: false };
      return {
        ...block,
        thinking: truncated.text,
        _meta: {
          ...(block._meta ?? {}),
          contentDetail: "summary",
          truncated: truncated.truncated,
          fullLength: block.thinking.length,
        },
      };
    }
    if (block.type === "tool_use") {
      return {
        ...block,
        input: summarizeToolInput(block.name, block.input),
        _meta: {
          ...(block._meta ?? {}),
          contentDetail: "summary",
        },
      };
    }
    if (block.type === "tool_result") {
      const outputLength =
        typeof block.content === "string" ? block.content.length : JSON.stringify(block.content).length;
      return {
        ...block,
        content: "",
        _meta: {
          ...(block._meta ?? {}),
          contentDetail: "summary",
          outputLength,
        },
      };
    }
    return block;
  });
};

export const summarizeMessageForHistory = <T extends { content: ContentBlock[]; meta: unknown }>(message: T): T => {
  const meta = (message.meta && typeof message.meta === "object" && !Array.isArray(message.meta))
    ? (message.meta as Record<string, unknown>)
    : {};
  return {
    ...message,
    content: summarizeContentForDefaultView(message.content),
    meta: {
      ...meta,
      contentDetail: "summary",
      historySummary: getHistorySummary(message.content),
    },
  };
};

export const markMessageAsFull = <T extends { meta: unknown }>(message: T): T => {
  const meta = (message.meta && typeof message.meta === "object" && !Array.isArray(message.meta))
    ? (message.meta as Record<string, unknown>)
    : {};
  return {
    ...message,
    meta: {
      ...meta,
      contentDetail: "full",
    },
  };
};

const normalizeUsage = (usage: PersistMessageInput["message"]["usage"]): Usage | null => {
  if (!usage || typeof usage !== "object") return null;
  return {
    input: typeof usage.input === "number" ? usage.input : undefined,
    output: typeof usage.output === "number" ? usage.output : undefined,
    cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
    cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
    totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
    cost: usage.cost && typeof usage.cost === "object"
      ? {
          input: typeof usage.cost.input === "number" ? usage.cost.input : undefined,
          output: typeof usage.cost.output === "number" ? usage.cost.output : undefined,
          cacheRead: typeof usage.cost.cacheRead === "number" ? usage.cost.cacheRead : undefined,
          cacheWrite: typeof usage.cost.cacheWrite === "number" ? usage.cost.cacheWrite : undefined,
          total: typeof usage.cost.total === "number" ? usage.cost.total : undefined,
        }
      : null,
  };
};

const toUtcHourBucket = (date: Date) => new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate(),
  date.getUTCHours(),
  0,
  0,
  0,
));

const resolveActorUserId = async (input: {
  sessionId: string;
  anchorUserMessageId?: string | null;
  userId?: string | null;
}) => {
  // Primary: direct userId from caller (agent passes it explicitly)
  if (input.userId) return input.userId;

  // Fallback: resolve from anchor user message's meta
  const anchorUserMessageId = input.anchorUserMessageId?.trim();
  if (!anchorUserMessageId) return null;
  const [anchorMessage] = await db.select({ meta: sessionMessages.meta }).from(sessionMessages).where(
    and(eq(sessionMessages.id, anchorUserMessageId), eq(sessionMessages.sessionId, input.sessionId)),
  ).limit(1);
  const actorUserId = (anchorMessage?.meta as Record<string, unknown> | null | undefined)?.actorUserId;
  return typeof actorUserId === "string" && actorUserId.trim() ? actorUserId.trim() : null;
};

const updateTokenUsageStatsHourly = async (input: {
  bucketStartAt: Date;
  userId: string | null;
  spaceId: string;
  sessionId: string;
  provider: string | null;
  model: string | null;
  usage: Usage | null;
  success: boolean;
}) => {
  const usage = input.usage;
  await db.insert(tokenUsageStatsHourly).values({
    bucketStartAt: input.bucketStartAt,
    userId: input.userId,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    provider: input.provider,
    model: input.model,
    requestCount: 1,
    successCount: input.success ? 1 : 0,
    errorCount: input.success ? 0 : 1,
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    costInput: String(usage?.cost?.input ?? 0),
    costOutput: String(usage?.cost?.output ?? 0),
    costCacheRead: String(usage?.cost?.cacheRead ?? 0),
    costCacheWrite: String(usage?.cost?.cacheWrite ?? 0),
    costTotal: String(usage?.cost?.total ?? 0),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      tokenUsageStatsHourly.bucketStartAt,
      tokenUsageStatsHourly.userId,
      tokenUsageStatsHourly.spaceId,
      tokenUsageStatsHourly.sessionId,
      tokenUsageStatsHourly.provider,
      tokenUsageStatsHourly.model,
    ],
    set: {
      requestCount: sql`${tokenUsageStatsHourly.requestCount} + 1`,
      successCount: sql`${tokenUsageStatsHourly.successCount} + ${input.success ? 1 : 0}`,
      errorCount: sql`${tokenUsageStatsHourly.errorCount} + ${input.success ? 0 : 1}`,
      inputTokens: sql`${tokenUsageStatsHourly.inputTokens} + ${usage?.input ?? 0}`,
      outputTokens: sql`${tokenUsageStatsHourly.outputTokens} + ${usage?.output ?? 0}`,
      cacheReadTokens: sql`${tokenUsageStatsHourly.cacheReadTokens} + ${usage?.cacheRead ?? 0}`,
      cacheWriteTokens: sql`${tokenUsageStatsHourly.cacheWriteTokens} + ${usage?.cacheWrite ?? 0}`,
      totalTokens: sql`${tokenUsageStatsHourly.totalTokens} + ${usage?.totalTokens ?? 0}`,
      costInput: sql`${tokenUsageStatsHourly.costInput} + ${String(usage?.cost?.input ?? 0)}::numeric`,
      costOutput: sql`${tokenUsageStatsHourly.costOutput} + ${String(usage?.cost?.output ?? 0)}::numeric`,
      costCacheRead: sql`${tokenUsageStatsHourly.costCacheRead} + ${String(usage?.cost?.cacheRead ?? 0)}::numeric`,
      costCacheWrite: sql`${tokenUsageStatsHourly.costCacheWrite} + ${String(usage?.cost?.cacheWrite ?? 0)}::numeric`,
      costTotal: sql`${tokenUsageStatsHourly.costTotal} + ${String(usage?.cost?.total ?? 0)}::numeric`,
      updatedAt: new Date(),
    },
  });
};

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

export const setSpaceEnv = async (spaceId: string, envs: Array<{ name: string; value: string }>) => {
  const key = SPACE_ENV_REDIS_KEY(spaceId);
  const { redisCommandClient } = await import("./redis.js");
  try {
    await redisCommandClient.set(key, JSON.stringify(envs), "EX", 3600);
  } catch (err) {
    // DB is already updated; Redis write failure means agent may serve stale env
    // until next space reconnection or TTL expiry
    console.warn(`[SpaceEnv] Failed to write env cache for ${spaceId}: ${err instanceof Error ? err.message : String(err)}`);
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

export const getSessionMessageById = async (spaceSessionId: string, messageId: string) => {
  const [message] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, spaceSessionId), eq(sessionMessages.id, messageId))).limit(1);
  return message ?? null;
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
  const _shouldDispatchToProvider = messageRole === "assistant";
  const normalizedUsage = normalizeUsage(input.message.usage);

  const hasError = input.message.errorMessage || input.message.stopReason === "error" || input.message.stopReason === "aborted";
  if (messageRole === "assistant" && content.length === 0 && !text?.trim() && !hasError) {
    throw new Error("Refusing to persist empty assistant message");
  }


  let anchorUserMessageId = input.anchorUserMessageId?.trim() || null;
  const userId = input.userId ?? null;
  const toolUseCount = countToolCallsInContent(content);
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
    usage: normalizedUsage,
  }).returning();
  if (!messageNode) throw new Error("Failed to persist message");

  if (messageRole === "assistant") {
    const actorUserId = await resolveActorUserId({
      sessionId: input.sessionId,
      anchorUserMessageId,
      userId,
    });
    await updateTokenUsageStatsHourly({
      bucketStartAt: toUtcHourBucket(messageNode.createdAt ?? new Date()),
      userId: actorUserId,
      spaceId: session.spaceId,
      sessionId: input.sessionId,
      provider: input.message.provider ?? null,
      model: input.message.model ?? null,
      usage: normalizedUsage,
      success: !hasError,
    });
  }

  if (messageRole === "user" && !session.title?.trim()) {
    const titleText = (text ?? extractPlainText(content)).replace(/\s+/g, " ").replace(/^[:\-\s]+/, "").trim().slice(0, 60);
    if (titleText) {
      await db.update(spaceSessions).set({ title: titleText, updatedAt: new Date() }).where(eq(spaceSessions.id, input.sessionId));
    }
  }

  await updateSessionAfterAppend(input.sessionId, messageNode);

  const realtimeMessage = {
    ...messageNode,
    role: messageNode.role as "user" | "assistant" | "system",
    meta: (messageNode.meta as Record<string, unknown> | null) ?? null,
    createdAt: messageNode.createdAt instanceof Date ? messageNode.createdAt.toISOString() : new Date().toISOString(),
  };
  const outputs = await buildSessionOutputsForPersistedMessage({
    spaceId: session.spaceId,
    sessionId: session.id,
    message: realtimeMessage,
  });
  await dispatchSessionOutputs(outputs).catch(console.error);

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
  if (messagesToCopy.length > 0) {
    await db.insert(sessionMessages).values(
      messagesToCopy.map((message) => ({
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
        usage: (message.usage as Usage | null | undefined) ?? null,
      })),
    );
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

  const lease = await resolveOrClaimSessionOwner(input.spaceId, input.sessionId);
  const actorUserId = typeof input.meta?.actorUserId === "string" && input.meta.actorUserId.trim()
    ? input.meta.actorUserId.trim()
    : null;
  const source = typeof input.meta?.source === "string" && input.meta.source.trim()
    ? input.meta.source.trim()
    : "prompt";
  const executionGrant = await createExecutionGrant({
    actorUserId,
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    source,
  });

  // Inject trace context so the Agent can continue the same trace
  const traceCarrier = injectTrace();

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
      executionAuth: executionGrant,
      timestamp: new Date().toISOString(),
      expectedOwnerId: lease.ownerId,
      expectedEpoch: lease.epoch,
      ...traceCarrier,
    }),
  );
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
