import { createLogger } from "@cohub/infra/logging";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Usage } from "@cohub/protocol/core";
import type { PersistMessageInput, RegisterSessionInput, SessionTurnRecord, UpdateSessionInfoInput } from "@cohub/protocol/model";
import { getOrCreateRequestId } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { SPACE_ENV_REDIS_KEY } from "@cohub/protocol/sandbox";
import { isSandboxUsableStatus } from "@cohub/sandbox-controller";
import { sanitizeContentBlocksForPostgresJson, sanitizePostgresJsonValue } from "@cohub/core/content/sanitize";
import { initializeSessionParticipantsMeta, readSessionParticipantUserUuids } from "@cohub/core/sessions";
import { db } from "./db/index.js";
import {
  sessionMessages,
  sessionTurnSegments,
  sessionTurns,
  spaceMembers,
  spaceSessions,
  spaces,
  tokenUsageStatsHourly,
} from "@cohub/db";
import {
  getSpaceWsUsersKey,
  getSpaceWsUsersUpdatedAtKey,
  redisCommandClient,
} from "./redis.js";
import { getSpaceSandboxBySpaceId, updateSpaceSandbox } from "./space-sandboxes.js";
import { buildSessionOutputsForPersistedMessage, dispatchSessionOutputs, dispatchTurnFinalized } from "./session-output.js";
import { dispatchSessionCreated, dispatchSessionUpdated, dispatchTurnCreated } from "./realtime-events.js";
import { finalizeSessionTurnFromMessage, hydrateTurnAuthorProfiles } from "./session-turns.js";
import { enqueueAgentSessionForkJob } from "./agent-turn-queue.js";
import { requestAgentTurnAbort } from "./agent-turn-abort.js";
import { countToolCallsInContent, deriveMessagePreviewText, extractPlainText } from "./session-content.js";
import { fallbackPublicUserProfile, getProfilesByUuids } from "./user-profiles.js";
import { billingOperations, COHUB_BILLING_TOKEN_TYPES, COHUB_BILLING_USAGE_TYPES } from "./billing/index.js";


const logger = createLogger({ serviceName: "cohub-api" });
export class SandboxNotReadyError extends Error {
  constructor(message = "space sandbox is not ready") {
    super(message);
    this.name = "SandboxNotReadyError";
  }
}

export class SpaceEnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpaceEnvValidationError";
  }
}

const normalizeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

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

const toDateOrNull = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const durationBetweenMs = (startedAt: Date | null, completedAt: Date | null) => {
  if (!startedAt || !completedAt) return null;
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
};

const normalizeDurationMs = (value: unknown, fallback: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;

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
  const userId = (anchorMessage?.meta as Record<string, unknown> | null | undefined)?.userId;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
};

const getUsageCostTotal = (usage: Usage | null | undefined) => {
  const total = usage?.cost?.total;
  return typeof total === "number" && Number.isFinite(total) && total > 0
    ? Number(total.toFixed(8))
    : 0;
};

const recordLlmUsageBilling = async (input: {
  messageId: string;
  userId: string | null;
  provider: string | null;
  model: string | null;
  usage: Usage | null;
  stopReason: string | null;
  errorMessage: string | null;
}) => {
  if (!billingOperations.status.configured) return;
  if (!input.userId) return;
  if (input.errorMessage || input.stopReason === "error" || input.stopReason === "aborted") return;
  const amountUsd = getUsageCostTotal(input.usage);
  if (amountUsd <= 0) return;

  try {
    const result = await billingOperations.recordUsage({
      userId: input.userId,
      amountUsd,
      tokenType: COHUB_BILLING_TOKEN_TYPES.usdMicroCent,
      usageType: COHUB_BILLING_USAGE_TYPES.generationLlm,
      sourceId: input.messageId,
      operationId: `llm:${input.messageId}`,
      reason: `LLM usage ${input.provider ?? "unknown"}/${input.model ?? "unknown"}`,
    });
    if (result.status === "overage") {
      logger.warn("[Billing] LLM usage recorded as overage", {
        userId: input.userId,
        messageId: input.messageId,
        amountUsd,
        provider: input.provider,
        model: input.model,
      });
    }
  } catch (error) {
    logger.warn("[Billing] failed to record LLM usage", {
      userId: input.userId,
      messageId: input.messageId,
      amountUsd,
      provider: input.provider,
      model: input.model,
      error,
    });
  }
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
  if (envs.length > 50) throw new SpaceEnvValidationError("extraEnv cannot exceed 50 entries");
  const seen = new Set<string>();
  for (const env of envs) {
    if (env.name.length > 128) throw new SpaceEnvValidationError("env name too long");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.name)) {
      throw new SpaceEnvValidationError("env name must start with a letter or underscore and contain only letters, numbers, and underscores");
    }
    if (env.value.length > 4000) throw new SpaceEnvValidationError("env value too long");
    if (seen.has(env.name)) throw new SpaceEnvValidationError(`duplicate env name: ${env.name}`);
    seen.add(env.name);
  }
};

export const setSpaceEnv = async (spaceId: string, envs: Array<{ name: string; value: string }>) => {
  const key = SPACE_ENV_REDIS_KEY(spaceId);
  const { redisCommandClient } = await import("./redis.js");
  try {
    await redisCommandClient.set(key, JSON.stringify(envs));
  } catch (err) {
    // DB is already updated; Redis write failure means agent may serve stale env
    // until the next successful env update or refresh after Redis recovers
    logger.warn(`[SpaceEnv] Failed to write env cache for ${spaceId}: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const getSpaceById = async (spaceId: string) => {
  const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  return space ?? null;
};

export const recomputeSpaceWsUsers = async (spaceId: string) => {
  const [space] = await db.select({ ownerId: spaces.userUuid }).from(spaces).where(eq(spaces.id, spaceId)).limit(1);
  const members = await db.select({ userId: spaceMembers.userId }).from(spaceMembers).where(eq(spaceMembers.spaceId, spaceId));
  const userIds = new Set<string>();
  if (space?.ownerId) userIds.add(space.ownerId);
  for (const member of members) {
    if (member.userId) userIds.add(member.userId);
  }
  const values = [...userIds];
  const pipeline = redisCommandClient.pipeline();
  const key = getSpaceWsUsersKey(spaceId);
  pipeline.del(key);
  if (values.length > 0) pipeline.sadd(key, ...values);
  pipeline.set(getSpaceWsUsersUpdatedAtKey(spaceId), String(Date.now()));
  await pipeline.exec();
  return values;
};

export const getSpaceSessionById = async (spaceSessionId: string) => {
  const [session] = await db.select().from(spaceSessions).where(eq(spaceSessions.id, spaceSessionId)).limit(1);
  return session ?? null;
};

export const getSessionMessageById = async (spaceSessionId: string, messageId: string) => {
  const [message] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, spaceSessionId), eq(sessionMessages.id, messageId))).limit(1);
  return message ?? null;
};

export const ensureRootSessionTurnSegment = async (sessionId: string) => {
  await db.insert(sessionTurnSegments).values({
    sessionId,
    ordinal: 1,
    sourceSessionId: sessionId,
    fromSequence: 1,
    toSequence: null,
  }).onConflictDoNothing({
    target: [sessionTurnSegments.sessionId, sessionTurnSegments.ordinal],
  });
};

const normalizeRequiredUserUuid = (userUuid: string | null | undefined) => {
  const normalized = userUuid?.trim();
  if (!normalized) throw new Error("userUuid is required");
  return normalized;
};

export const createInitialSpaceSession = async (input: RegisterSessionInput) => {
  const userUuid = normalizeRequiredUserUuid(input.userUuid);
  const [session] = await db.insert(spaceSessions).values({
    id: input.sessionId,
    spaceId: input.spaceId,
    userUuid,
    title: input.title ?? null,
    source: input.source ?? null,
    status: "active",
    externalSessionId: input.externalSessionId ?? null,
    meta: sanitizePostgresJsonValue(initializeSessionParticipantsMeta(input.meta, userUuid)),
    lastMessageAt: new Date(),
    lastMessageId: null,
  }).returning();
  if (!session) throw new Error("Failed to create initial space session");
  await ensureRootSessionTurnSegment(input.sessionId);
  await dispatchSessionCreated(session).catch((error) => {
    logger.warn("[Realtime] failed to dispatch session.created", error);
  });
  return session;
};

export const registerSpaceSession = async (input: RegisterSessionInput) => {
  const space = await getSpaceById(input.spaceId);
  if (!space) throw new Error("Space not found");

  const userUuid = normalizeRequiredUserUuid(input.userUuid);

  try {
    const [session] = await db.insert(spaceSessions).values({
      id: input.sessionId,
      spaceId: input.spaceId,
      userUuid,
      title: input.title ?? null,
      source: input.source ?? null,
      status: "active",
      externalSessionId: input.externalSessionId ?? null,
      meta: sanitizePostgresJsonValue(initializeSessionParticipantsMeta(input.meta, userUuid)),
      lastMessageAt: new Date(),
      lastMessageId: null,
    }).returning();
    if (!session) throw new Error("Failed to register space session");
    await ensureRootSessionTurnSegment(input.sessionId);
    await dispatchSessionCreated(session).catch((error) => {
      logger.warn("[Realtime] failed to dispatch session.created", error);
    });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("duplicate key") || message.includes("already exists") || message.includes("unique")) {
      const [existing] = await db.select().from(spaceSessions).where(eq(spaceSessions.id, input.sessionId)).limit(1);
      if (existing) {
        await ensureRootSessionTurnSegment(existing.id);
        return existing;
      }
    }
    throw error;
  }
};

const DEFAULT_SESSION_LIST_LIMIT = 20;
const MAX_SESSION_LIST_LIMIT = 100;

const encodeSessionListCursor = (
  session: typeof spaceSessions.$inferSelect | null | undefined,
) => {
  if (!session?.lastMessageAt) return null;
  const lastMessageAt = session.lastMessageAt instanceof Date
    ? session.lastMessageAt.toISOString()
    : new Date(session.lastMessageAt).toISOString();
  return `${lastMessageAt}|${session.id}`;
};

const decodeSessionListCursor = (cursor: string | null | undefined) => {
  if (!cursor) return null;
  const separatorIndex = cursor.lastIndexOf("|");
  const rawDate = separatorIndex > 0 ? cursor.slice(0, separatorIndex) : cursor;
  const id = separatorIndex > 0 ? cursor.slice(separatorIndex + 1) : null;
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return null;
  return { date, id };
};

export const hydrateSessionParticipantProfiles = async <T extends typeof spaceSessions.$inferSelect>(sessions: T[]) => {
  const allUserUuids = new Set<string>();
  for (const session of sessions) {
    if (session.userUuid?.trim()) allUserUuids.add(session.userUuid.trim());
    for (const userUuid of readSessionParticipantUserUuids(session.meta)) allUserUuids.add(userUuid);
  }

  const profiles = await getProfilesByUuids([...allUserUuids]);
  return sessions.map((session) => {
    const participantUserUuids = readSessionParticipantUserUuids(session.meta);
    const userUuid = session.userUuid?.trim() || null;
    return {
      ...session,
      userUuid,
      userProfile: userUuid ? profiles.get(userUuid) ?? fallbackPublicUserProfile(userUuid) : null,
      participantUserUuids,
      participantProfiles: participantUserUuids.map((uuid) => profiles.get(uuid) ?? fallbackPublicUserProfile(uuid)),
    };
  });
};

export const listSpaceSessions = async (
  spaceId: string,
  options?: { limit?: number; cursor?: string | null },
) => {
  const rawLimit = Math.trunc(options?.limit ?? DEFAULT_SESSION_LIST_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_SESSION_LIST_LIMIT)
    : DEFAULT_SESSION_LIST_LIMIT;
  const cursor = decodeSessionListCursor(options?.cursor);

  const rows = await db.select().from(spaceSessions).where(
    cursor
      ? and(
        eq(spaceSessions.spaceId, spaceId),
        or(
          lt(spaceSessions.lastMessageAt, cursor.date),
          cursor.id
            ? and(
              eq(spaceSessions.lastMessageAt, cursor.date),
              lt(spaceSessions.id, cursor.id),
            )
            : undefined,
          isNull(spaceSessions.lastMessageAt),
        ),
      )
      : eq(spaceSessions.spaceId, spaceId),
  ).orderBy(
    sql`${spaceSessions.lastMessageAt} desc nulls last`,
    desc(spaceSessions.id),
  ).limit(limit + 1);

  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const lastSession = sessions.at(-1);

  return {
    sessions,
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? encodeSessionListCursor(lastSession) : null,
    },
  };
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
  const refreshed = await getSpaceSessionById(sessionId);
  if (refreshed) {
    await dispatchSessionUpdated({
      session: refreshed,
      changed: ["lastMessageId", "latestMessageText", "lastMessageAt", "updatedAt"],
    }).catch((error) => {
      logger.warn("[Realtime] failed to dispatch session.updated after message append", error);
    });
  }
};

export const persistMessageNode = async (input: PersistMessageInput & { message: PersistMessageInput["message"] & { id?: string } }) => {
  const [existing] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, input.sessionId), eq(sessionMessages.idempotencyKey, input.idempotencyKey))).limit(1);
  if (existing) {
    if (existing.role === "assistant") {
      const session = await getSpaceSessionById(input.sessionId);
      if (session && session.spaceId === input.spaceId) {
        const meta = normalizeRecord(existing.meta);
        const anchorUserMessageId = typeof meta?.anchorUserMessageId === "string" ? meta.anchorUserMessageId : null;
        const actorUserId = await resolveActorUserId({
          sessionId: input.sessionId,
          anchorUserMessageId,
          userId: input.userId ?? null,
        });
        await recordLlmUsageBilling({
          messageId: existing.id,
          userId: actorUserId,
          provider: existing.provider,
          model: existing.model,
          usage: existing.usage as Usage | null,
          stopReason: existing.stopReason,
          errorMessage: existing.errorMessage,
        });
      }
    }
    return existing;
  }

  const session = await getSpaceSessionById(input.sessionId);
  if (!session || session.spaceId !== input.spaceId) throw new Error("Space session not found");

  if (input.previousMessageId) {
    const [previous] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.id, input.previousMessageId), eq(sessionMessages.sessionId, input.sessionId))).limit(1);
    if (!previous) throw new Error("Previous message not found");
  }

  const sequence = await getNextSessionSequence(input.sessionId);
  const content = sanitizeContentBlocksForPostgresJson(input.message.content);
  const text = deriveMessagePreviewText({ content }) || null;
  const messageRole = input.message.role ?? "assistant";
  const _shouldDispatchToProvider = messageRole === "assistant";
  const normalizedUsage = normalizeUsage(input.message.usage);

  const isAborted = input.message.stopReason === "aborted";
  const hasError = input.message.errorMessage || input.message.stopReason === "error";
  const isUnsuccessful = hasError || isAborted;
  if (messageRole === "assistant" && content.length === 0 && !text?.trim() && !isUnsuccessful) {
    throw new Error("Refusing to persist empty assistant message");
  }


  let anchorUserMessageId = input.anchorUserMessageId?.trim() || null;
  const userId = input.userId ?? null;
  const toolUseCount = countToolCallsInContent(content);
  const requestedMessageKind = (input.message.meta as Record<string, unknown> | null | undefined)?.messageKind;
  const isDirectShellCommandResult = requestedMessageKind === "shell_command_result";
  const messageKind = messageRole !== "assistant" ? messageRole : isUnsuccessful ? "assistant_error" : isDirectShellCommandResult ? "assistant_final" : (toolUseCount > 0 || input.message.stopReason === "tool_use") ? "assistant_intermediate" : "assistant_final";
  const displayErrorMessage = isAborted ? null : input.message.errorMessage ?? null;
  const completedAt = toDateOrNull(input.message.completedAt) ?? new Date();
  const startedAt = toDateOrNull(input.message.startedAt) ?? completedAt;
  const durationMs = normalizeDurationMs(input.message.durationMs, durationBetweenMs(startedAt, completedAt));
  let assistantActorUserId: string | null = null;

  const [messageNode] = await db.insert(sessionMessages).values({
    id: input.message.id?.trim() || undefined,
    sessionId: input.sessionId,
    role: messageRole,
    content,
    text,
    meta: sanitizePostgresJsonValue({
      ...((input.message.meta as Record<string, unknown> | null) ?? {}),
      messageKind,
      anchorUserMessageId,
      providerResponseId: ((input.message.meta as Record<string, unknown> | null)?.responseId as string | undefined) ?? null,
    }),
    idempotencyKey: input.idempotencyKey,
    sequence,
    provider: input.message.provider ?? null,
    model: input.message.model ?? null,
    stopReason: input.message.stopReason ?? null,
    errorMessage: displayErrorMessage ? sanitizePostgresJsonValue(displayErrorMessage) : displayErrorMessage,
    usage: normalizedUsage,
    startedAt,
    completedAt,
    durationMs,
  }).returning();
  if (!messageNode) throw new Error("Failed to persist message");

  if (messageRole === "assistant") {
    const actorUserId = await resolveActorUserId({
      sessionId: input.sessionId,
      anchorUserMessageId,
      userId,
    });
    assistantActorUserId = actorUserId;
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

  if (messageRole === "user") {
    const turnId = typeof (input.message.meta as Record<string, unknown> | null | undefined)?.turnId === "string"
      ? ((input.message.meta as Record<string, unknown>).turnId as string)
      : null;
    if (turnId) {
      const [turnRow] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.id, turnId), eq(sessionTurns.sessionId, input.sessionId))).limit(1);
      if (turnRow) {
        const turnRecord: SessionTurnRecord = {
          id: turnRow.id,
          sessionId: turnRow.sessionId,
          userUuid: turnRow.userUuid ?? null,
          sequence: turnRow.sequence,
          status: turnRow.status as SessionTurnRecord["status"],
          intent: turnRow.intent as SessionTurnRecord["intent"],
          userContent: turnRow.userContent,
          userText: turnRow.userText ?? null,
          assistantContent: turnRow.assistantContent ?? null,
          assistantText: turnRow.assistantText ?? null,
          provider: turnRow.provider ?? null,
          model: turnRow.model ?? null,
          stopReason: turnRow.stopReason ?? null,
          errorMessage: turnRow.errorMessage ?? null,
          finalUsage: turnRow.finalUsage ?? null,
          totalUsage: turnRow.totalUsage ?? null,
          summary: turnRow.summary ?? null,
          intermediateIndex: turnRow.intermediateIndex ?? null,
          intermediateSummary: turnRow.intermediateSummary ?? null,
          meta: normalizeRecord(turnRow.meta),
          startedAt: turnRow.startedAt instanceof Date ? turnRow.startedAt.toISOString() : null,
          completedAt: turnRow.completedAt instanceof Date ? turnRow.completedAt.toISOString() : null,
          durationMs: turnRow.durationMs ?? null,
          createdAt: turnRow.createdAt instanceof Date ? turnRow.createdAt.toISOString() : new Date().toISOString(),
          updatedAt: turnRow.updatedAt instanceof Date ? turnRow.updatedAt.toISOString() : new Date().toISOString(),
        };
        const [turn = turnRecord] = await hydrateTurnAuthorProfiles([turnRecord]);
        await dispatchTurnCreated({
          spaceId: session.spaceId,
          sessionId: input.sessionId,
          turn,
        }).catch((error) => {
          logger.warn("[Realtime] failed to dispatch session.turn.created", error);
        });
      }
    }
  }

  if (messageRole === "assistant") {
    const turnId = typeof (input.message.meta as Record<string, unknown> | null | undefined)?.turnId === "string"
      ? ((input.message.meta as Record<string, unknown>).turnId as string)
      : null;
    if (turnId && (messageKind === "assistant_final" || messageKind === "assistant_error")) {
      const messageMeta = normalizeRecord(input.message.meta);
      const agentMeta = normalizeRecord(messageMeta?.agent);
      const agentSessionEntryId = typeof messageMeta?.agentSessionEntryId === "string"
        ? messageMeta.agentSessionEntryId
        : typeof agentMeta?.leafEntryId === "string"
          ? agentMeta.leafEntryId
          : null;
      const finalizedTurn = await finalizeSessionTurnFromMessage({
        spaceId: session.spaceId,
        sessionId: input.sessionId,
        turnId,
        status: isAborted ? "interrupted" : messageKind === "assistant_error" ? "failed" : "completed",
        assistantContent: content,
        assistantText: text,
        provider: input.message.provider ?? null,
        model: input.message.model ?? null,
        stopReason: input.message.stopReason ?? null,
        errorMessage: displayErrorMessage,
        usage: normalizedUsage,
        metaPatch: {
          ...(agentSessionEntryId ? { agentSessionEntryId } : {}),
          ...(typeof messageNode.durationMs === "number" ? { finalMessageDurationMs: messageNode.durationMs } : {}),
        },
      }).catch((error) => {
        logger.warn("[SessionTurn] failed to finalize turn", error);
        return null;
      });
      if (finalizedTurn) {
        await dispatchTurnFinalized({ spaceId: session.spaceId, sessionId: input.sessionId, turn: finalizedTurn }).catch((error) => {
          logger.warn("[SessionTurn] failed to dispatch finalized turn", error);
        });
      }
    }
  }

  const realtimeMessage = {
    ...messageNode,
    role: messageNode.role as "user" | "assistant" | "system",
    meta: (messageNode.meta as Record<string, unknown> | null) ?? null,
    startedAt: messageNode.startedAt instanceof Date ? messageNode.startedAt.toISOString() : null,
    completedAt: messageNode.completedAt instanceof Date ? messageNode.completedAt.toISOString() : null,
    durationMs: messageNode.durationMs ?? null,
    createdAt: messageNode.createdAt instanceof Date ? messageNode.createdAt.toISOString() : new Date().toISOString(),
  };
  const outputs = await buildSessionOutputsForPersistedMessage({
    spaceId: session.spaceId,
    sessionId: session.id,
    message: realtimeMessage,
  });
  await dispatchSessionOutputs(outputs).catch((error) => logger.error("[SpaceSessions] failed to dispatch session outputs", error));

  if (messageRole === "assistant") {
    await recordLlmUsageBilling({
      messageId: messageNode.id,
      userId: assistantActorUserId,
      provider: input.message.provider ?? null,
      model: input.message.model ?? null,
      usage: normalizedUsage,
      stopReason: input.message.stopReason ?? null,
      errorMessage: displayErrorMessage,
    });
  }

  return messageNode;
};

export const updateSpaceSessionInfo = async (input: UpdateSessionInfoInput) => {
  const session = await getSpaceSessionById(input.sessionId);
  if (!session || session.spaceId !== input.spaceId) throw new Error("Space session not found");

  const nextTitle = input.title === undefined ? session.title : (input.title ?? null);
  const nextLastMessageAt = input.updatedAt === undefined ? session.lastMessageAt : input.updatedAt ? new Date(input.updatedAt) : null;
  const changed = [
    ...(nextTitle !== session.title ? ["title"] : []),
    ...(input.updatedAt !== undefined ? ["lastMessageAt"] : []),
    ...(input.meta !== undefined ? ["meta"] : []),
  ];

  await db.update(spaceSessions).set({
    title: nextTitle,
    lastMessageAt: nextLastMessageAt,
    meta: input.meta === undefined ? session.meta : { ...((session.meta as Record<string, unknown> | null) ?? {}), ...(input.meta ?? {}) },
    updatedAt: new Date(),
  }).where(eq(spaceSessions.id, input.sessionId));

  if (changed.length > 0) {
    const refreshed = await getSpaceSessionById(input.sessionId);
    if (refreshed) {
      await dispatchSessionUpdated({ session: refreshed, changed }).catch((error) => {
        logger.warn("[Realtime] failed to dispatch session.updated", error);
      });
    }
  }
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

export const enqueueSessionFork = async (input: { spaceId: string; sessionId: string; parentSessionId: string; anchorTurnId: string; anchorSequence: number; anchorEntryId: string }) => {
  const traceCarrier = injectTrace();
  await enqueueAgentSessionForkJob({
    ...input,
    requestId: getOrCreateRequestId(),
    trace: traceCarrier,
  });
};

export const enqueueSessionAbort = async (input: { spaceId: string; sessionId: string; actorUserId?: string | null; turnId?: string | null }) => {
  const explicitTurnId = input.turnId?.trim() || null;
  const turnId = explicitTurnId ?? ((await db.select({ id: sessionTurns.id })
    .from(sessionTurns)
    .where(and(
      eq(sessionTurns.sessionId, input.sessionId),
      inArray(sessionTurns.status, ["running", "abort_requested"]),
    ))
    .orderBy(desc(sessionTurns.sequence))
    .limit(1))[0]?.id ?? null);

  if (!turnId) return;

  await db.update(sessionTurns).set({
    status: "abort_requested",
    meta: sql`coalesce(${sessionTurns.meta}, '{}'::jsonb) || ${JSON.stringify({
      abortRequestedAt: new Date().toISOString(),
      abortActorUserId: input.actorUserId ?? null,
    })}::jsonb`,
    updatedAt: new Date(),
  }).where(and(
    eq(sessionTurns.id, turnId),
    eq(sessionTurns.sessionId, input.sessionId),
    inArray(sessionTurns.status, ["running", "abort_requested"]),
  ));

  await requestAgentTurnAbort({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    turnId,
    reason: "abort",
    actorUserId: input.actorUserId ?? null,
  });
};

export const waitForSpaceReady = async (spaceId: string, timeoutMs = 30000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sandbox = await getSpaceSandboxBySpaceId(spaceId);
    if (!sandbox) return false;
    if (isSandboxUsableStatus(sandbox.status)) return true;
    if (sandbox.status === "error") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};

export const updateSpaceStatus = async (spaceId: string, status: string) => {
  const normalizedStatus =
    status === "running" || status === "ready"
      ? "running"
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
    runtimeStatus:
      normalizedStatus === "running"
        ? "healthy"
        : normalizedStatus === "provisioning"
          ? "starting"
          : normalizedStatus === "error"
            ? "unhealthy"
            : "unknown",
    podName: normalizedStatus === "terminated" || normalizedStatus === "stopped" ? null : `sandbox-${spaceId}`,
    lastHeartbeatAt: normalizedStatus === "running" || normalizedStatus === "provisioning" ? new Date() : undefined,
    meta: {
      ...((sandbox?.meta as Record<string, unknown> | null) ?? {}),
      lastStatus: status,
    },
  });
};
