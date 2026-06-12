import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ContentBlock, Usage } from "@cohub/protocol/core";
import type { MessageRecord, MessageToolCallsFile, PersistMessageInput, SessionTurnRecord, SessionTurnStatus, StoredIntermediateMessage, StoredToolCall, TurnIntermediateMessagesFile } from "@cohub/protocol/model";
import type { ChannelProvider, GatewayOutboundCommand } from "@cohub/protocol/gateway";
import { sessionMessages, sessionTurns, spaceChannels, spaceSessionBindings, spaceSessions, providerMessageRefs, tokenUsageStatsHourly, userChannels } from "@cohub/db";
import { sanitizeContentBlocksForPostgresJson, sanitizePostgresJsonValue } from "@cohub/core/content/sanitize";
import { countToolCallsInContent, deriveMessagePreviewText, extractPlainText } from "@cohub/core/sessions";
import { getReadableUserIdsForSpace } from "@cohub/core/spaces";
import { buildTraceHeaders, getCurrentRequestId } from "@cohub/infra/tracing";
import { normalizeAssistantTurn } from "./assistant-message-normalizer.js";
import { db } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { redis, publishRealtimeEnvelope, clearPersistedSessionStreamSnapshot, xaddWithMaxlen } from "./redis.js";
import { buildTurnObjectPrefix, writeTurnObjectJson } from "./turn-object-storage.js";

const GATEWAY_OUTBOUND_STREAM = "stream:gateway:outbound";

const INTERNAL_API_BASE_URL =
  env.ENV === "prod"
    ? "http://cohub-api.cohub.svc.cluster.local:8787"
    : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`).join(",")}}`;
};

const hash = async (value: string) => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
};

const buildAssistantIdempotencyKey = async (input: { previousMessageId: string; message: PersistMessageInput["message"] }) => hash(stableSerialize({ previousMessageId: input.previousMessageId, role: "assistant", message: input.message }));
const buildUserIdempotencyKey = async (input: { messageId: string; content: ContentBlock[]; meta?: Record<string, unknown> | null }) => hash(stableSerialize({ role: "user", messageId: input.messageId, content: input.content, meta: input.meta ?? null }));

const toDateOrNull = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const completeMessageTiming = (input?: { startedAt?: string | null; completedAt?: string | null; durationMs?: number | null } | null) => {
  const completedAt = toDateOrNull(input?.completedAt) ?? new Date();
  const startedAt = toDateOrNull(input?.startedAt) ?? completedAt;
  const durationMs = typeof input?.durationMs === "number" && Number.isFinite(input.durationMs)
    ? Math.max(0, Math.floor(input.durationMs))
    : Math.max(0, completedAt.getTime() - startedAt.getTime());
  return { startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), durationMs };
};

const normalizeUsage = (usage: PersistMessageInput["message"]["usage"]): Usage | null => {
  if (!usage || typeof usage !== "object") return null;
  return {
    input: typeof usage.input === "number" ? usage.input : undefined,
    output: typeof usage.output === "number" ? usage.output : undefined,
    cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
    cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
    totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
    cost: usage.cost && typeof usage.cost === "object" ? {
      input: typeof usage.cost.input === "number" ? usage.cost.input : undefined,
      output: typeof usage.cost.output === "number" ? usage.cost.output : undefined,
      cacheRead: typeof usage.cost.cacheRead === "number" ? usage.cost.cacheRead : undefined,
      cacheWrite: typeof usage.cost.cacheWrite === "number" ? usage.cost.cacheWrite : undefined,
      total: typeof usage.cost.total === "number" ? usage.cost.total : undefined,
    } : null,
  };
};

const normalizeRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const getNextSessionSequence = async (sessionId: string) => {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)::int` }).from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
  return (row?.max ?? 0) + 1;
};

const toIso = (value: Date | string | null | undefined) => value instanceof Date ? value.toISOString() : value ?? new Date().toISOString();
const toIsoOrNull = (value: Date | string | null | undefined) => value ? toIso(value) : null;

const toMessageRecord = (row: typeof sessionMessages.$inferSelect): MessageRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  role: row.role as MessageRecord["role"],
  content: row.content as ContentBlock[],
  text: row.text ?? null,
  sequence: row.sequence,
  provider: row.provider ?? null,
  model: row.model ?? null,
  stopReason: row.stopReason ?? null,
  errorMessage: row.errorMessage ?? null,
  usage: row.usage as Usage | null,
  meta: normalizeRecord(row.meta),
  startedAt: toIsoOrNull(row.startedAt),
  completedAt: toIsoOrNull(row.completedAt),
  durationMs: row.durationMs ?? null,
  createdAt: toIso(row.createdAt),
});

const toTurnRecord = (row: typeof sessionTurns.$inferSelect): SessionTurnRecord => ({
  id: row.id,
  sessionId: row.sessionId,
  userUuid: row.userUuid ?? null,
  sequence: row.sequence,
  status: row.status,
  intent: row.intent,
  userContent: row.userContent,
  userText: row.userText ?? null,
  assistantContent: row.assistantContent ?? null,
  assistantText: row.assistantText ?? null,
  provider: row.provider ?? null,
  model: row.model ?? null,
  stopReason: row.stopReason ?? null,
  errorMessage: row.errorMessage ?? null,
  finalUsage: row.finalUsage ?? null,
  totalUsage: row.totalUsage ?? null,
  summary: row.summary ?? null,
  intermediateIndex: row.intermediateIndex ?? null,
  intermediateSummary: row.intermediateSummary ?? null,
  meta: normalizeRecord(row.meta),
  startedAt: toIsoOrNull(row.startedAt),
  completedAt: toIsoOrNull(row.completedAt),
  durationMs: row.durationMs ?? null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const pickRealtimeMessageMeta = (meta: Record<string, unknown> | null | undefined) => {
  if (!meta) return null;
  const keys = ["messageKind", "clientMessageId", "anchorUserMessageId", "userId", "contentDetail", "contentPlaceholder", "historySummary", "turnId", "messageId"];
  const picked: Record<string, unknown> = {};
  for (const key of keys) if (meta[key] !== undefined) picked[key] = meta[key];
  return Object.keys(picked).length > 0 ? picked : null;
};

async function publishMessagePersisted(spaceId: string, message: MessageRecord) {
  const targetUserIds = await getReadableUserIdsForSpace({ db, spaceId }).catch(() => [] as string[]);
  await publishRealtimeEnvelope({
    domain: "session",
    type: "session.message.persisted",
    spaceId,
    sessionId: message.sessionId,
    payload: {
      message: { ...message, text: message.content.length > 0 ? null : message.text, meta: pickRealtimeMessageMeta(message.meta) },
      targetUserIds,
    },
  });
}

async function publishTurnCreated(spaceId: string, turn: SessionTurnRecord) {
  const targetUserIds = await getReadableUserIdsForSpace({ db, spaceId }).catch(() => [] as string[]);
  await publishRealtimeEnvelope({ domain: "session", type: "session.turn.created", spaceId, sessionId: turn.sessionId, payload: { turn, targetUserIds } });
}

async function publishTurnFinalized(spaceId: string, turn: SessionTurnRecord) {
  await clearPersistedSessionStreamSnapshot(spaceId, turn.sessionId);
  const targetUserIds = await getReadableUserIdsForSpace({ db, spaceId }).catch(() => [] as string[]);
  await publishRealtimeEnvelope({ domain: "session", type: "session.turn.finalized", spaceId, sessionId: turn.sessionId, payload: { turn, targetUserIds } });
}

async function updateSessionAfterAppend(sessionId: string, message: typeof sessionMessages.$inferSelect) {
  await db.update(spaceSessions).set({ lastMessageId: message.id, latestMessageText: message.text, lastMessageAt: message.createdAt ?? new Date(), updatedAt: new Date() }).where(eq(spaceSessions.id, sessionId));
}

const toUtcHourBucket = (date: Date) => new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  date.getUTCDate(),
  date.getUTCHours(),
  0,
  0,
  0,
));

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

async function persistMessageNode(input: PersistMessageInput & { message: PersistMessageInput["message"] & { id?: string } }): Promise<{ message: typeof sessionMessages.$inferSelect; created: boolean }> {
  const [existing] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, input.sessionId), eq(sessionMessages.idempotencyKey, input.idempotencyKey))).limit(1);
  if (existing) return { message: existing, created: false };

  const [session] = await db.select({ id: spaceSessions.id, spaceId: spaceSessions.spaceId, title: spaceSessions.title }).from(spaceSessions).where(eq(spaceSessions.id, input.sessionId)).limit(1);
  if (!session || session.spaceId !== input.spaceId) throw new Error("Space session not found");

  if (input.previousMessageId) {
    const [previous] = await db.select({ id: sessionMessages.id }).from(sessionMessages).where(and(eq(sessionMessages.id, input.previousMessageId), eq(sessionMessages.sessionId, input.sessionId))).limit(1);
    if (!previous) throw new Error("Previous message not found");
  }

  const sequence = await getNextSessionSequence(input.sessionId);
  const content = sanitizeContentBlocksForPostgresJson(input.message.content);
  const text = deriveMessagePreviewText({ content }) || null;
  const messageRole = input.message.role ?? "assistant";
  const normalizedUsage = normalizeUsage(input.message.usage);
  const isAborted = input.message.stopReason === "aborted";
  const hasError = Boolean(input.message.errorMessage) || input.message.stopReason === "error";
  const isUnsuccessful = hasError || isAborted;
  if (messageRole === "assistant" && content.length === 0 && !text?.trim() && !isUnsuccessful) throw new Error("Refusing to persist empty assistant message");

  const requestedMessageKind = input.message.meta?.messageKind;
  const messageKind = messageRole !== "assistant" ? messageRole : isUnsuccessful ? "assistant_error" : requestedMessageKind === "shell_command_result" ? "assistant_final" : (countToolCallsInContent(content) > 0 || input.message.stopReason === "tool_use") ? "assistant_intermediate" : "assistant_final";
  const completedAt = toDateOrNull(input.message.completedAt) ?? new Date();
  const startedAt = toDateOrNull(input.message.startedAt) ?? completedAt;
  const durationMs = typeof input.message.durationMs === "number" ? Math.max(0, Math.floor(input.message.durationMs)) : Math.max(0, completedAt.getTime() - startedAt.getTime());
  const anchorUserMessageId = input.anchorUserMessageId?.trim() || null;

  const [messageNode] = await db.insert(sessionMessages).values({
    id: input.message.id?.trim() || undefined,
    sessionId: input.sessionId,
    role: messageRole,
    content,
    text,
    meta: sanitizePostgresJsonValue({ ...input.message.meta, messageKind, anchorUserMessageId, providerResponseId: input.message.meta?.responseId ?? null }),
    idempotencyKey: input.idempotencyKey,
    sequence,
    provider: input.message.provider ?? null,
    model: input.message.model ?? null,
    stopReason: input.message.stopReason ?? null,
    errorMessage: isAborted ? null : input.message.errorMessage ?? null,
    usage: normalizedUsage,
    startedAt,
    completedAt,
    durationMs,
  }).returning();
  if (!messageNode) throw new Error("Failed to persist message");

  if (messageRole === "assistant") {
    await updateTokenUsageStatsHourly({
      bucketStartAt: toUtcHourBucket(messageNode.createdAt ?? new Date()),
      userId: input.userId ?? null,
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
    if (titleText) await db.update(spaceSessions).set({ title: titleText, updatedAt: new Date() }).where(eq(spaceSessions.id, input.sessionId));
  }
  await updateSessionAfterAppend(input.sessionId, messageNode);
  return { message: messageNode, created: true };
}

const addUsage = (a: Usage | null | undefined, b: Usage | null | undefined): Usage | null => {
  if (!a && !b) return null;
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
    cacheRead: (a?.cacheRead ?? 0) + (b?.cacheRead ?? 0),
    cacheWrite: (a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
    cost: a?.cost || b?.cost ? { total: (a?.cost?.total ?? 0) + (b?.cost?.total ?? 0) } : null,
  };
};

const addDurationMs = (a: number | null, b: number | null | undefined) => {
  if (typeof b !== "number" || !Number.isFinite(b)) return a;
  return (a ?? 0) + Math.max(0, Math.floor(b));
};

const truncateText = (text: string, limit: number) => {
  if (text.length <= limit) return { value: text, truncated: false, originalLength: text.length };
  return { value: `${text.slice(0, Math.max(0, limit - 1))}…`, truncated: true, originalLength: text.length };
};

const summarizeValue = (value: unknown, limit = 240): unknown => {
  if (typeof value === "string") {
    const truncated = truncateText(value, limit);
    return truncated.truncated ? { preview: truncated.value, _truncated: true, originalLength: truncated.originalLength } : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  try {
    const text = JSON.stringify(value);
    const truncated = truncateText(text, limit);
    return { preview: truncated.value, ...(truncated.truncated ? { _truncated: true, originalLength: truncated.originalLength } : {}) };
  } catch {
    const text = String(value);
    const truncated = truncateText(text, limit);
    return { preview: truncated.value, ...(truncated.truncated ? { _truncated: true, originalLength: truncated.originalLength } : {}) };
  }
};

const summarizeToolInput = (input: Record<string, unknown>) => Object.fromEntries(
  Object.entries(input).map(([key, value]) => [key, summarizeValue(value)]),
) as Record<string, unknown>;

const getContentLengthMeta = (content: string | ContentBlock[]) => typeof content === "string"
  ? { originalContentKind: "string", originalLength: content.length }
  : { originalContentKind: "content_blocks", originalBlockCount: content.length };

const extractToolCalls = (content: ContentBlock[]): StoredToolCall[] => {
  const byId = new Map<string, StoredToolCall>();
  for (const block of content) {
    if (block.type === "tool_use") {
      byId.set(block.id, {
        id: block.id,
        name: block.name,
        input: block.input,
        meta: normalizeRecord(block._meta),
        result: null,
      });
    }
  }
  for (const block of content) {
    if (block.type === "tool_result") {
      const existing = byId.get(block.tool_use_id);
      if (existing) {
        byId.set(block.tool_use_id, {
          ...existing,
          result: {
            content: block.content,
            isError: Boolean(block.is_error),
            meta: normalizeRecord(block._meta),
          },
        });
      }
    }
  }
  return [...byId.values()];
};

const summarizeIntermediateContent = (content: ContentBlock[], tools: StoredToolCall[]): ContentBlock[] => {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  return content.map((block) => {
    if (block.type === "tool_use") {
      const tool = byId.get(block.id);
      return {
        ...block,
        input: summarizeToolInput(tool?.input ?? block.input),
        _meta: {
          ...(block._meta ?? {}),
          contentDetail: "summary",
          inputDetail: "summary",
          toolStatus: tool?.result ? (tool.result.isError ? "failed" : "done") : "running",
        },
      };
    }
    if (block.type === "tool_result") {
      return {
        ...block,
        content: [],
        _meta: {
          ...(block._meta ?? {}),
          contentDetail: "summary",
          resultDetail: "omitted",
          ...getContentLengthMeta(block.content),
        },
      };
    }
    return block;
  });
};

const writeTurnObjects = async (files: Array<{ objectKey: string; value: unknown }>) => {
  const concurrency = Math.min(4, files.length);
  await Promise.all(Array.from({ length: concurrency }, async (_, workerIndex) => {
    for (let index = workerIndex; index < files.length; index += concurrency) {
      const file = files[index];
      if (!file) continue;
      await writeTurnObjectJson(file.objectKey, file.value);
    }
  }));
};

const buildIntermediateObjectsForTurn = async (input: { spaceId: string; sessionId: string; turnId: string }) => {
  const rows = await db.select().from(sessionMessages).where(and(
    eq(sessionMessages.sessionId, input.sessionId),
    sql`${sessionMessages.meta}->>'turnId' = ${input.turnId}`,
  )).orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));

  const intermediateRows = rows.filter((row) => {
    if (row.role === "user") return false;
    const meta = normalizeRecord(row.meta);
    return meta?.messageKind !== "assistant_final" && meta?.messageKind !== "assistant_error";
  });

  const prefix = buildTurnObjectPrefix(input);
  const toolCallsBaseObjectKey = `${prefix}intermediate/messages/`;
  let totalUsage: Usage | null = null;
  let totalDurationMs: number | null = null;
  let toolCallCount = 0;
  let hasError = false;

  const messages: StoredIntermediateMessage[] = [];
  const toolFiles: Array<{ objectKey: string; value: MessageToolCallsFile }> = [];
  for (const row of intermediateRows) {
    const content = row.content as ContentBlock[];
    const details = extractToolCalls(content);
    toolCallCount += details.length;
    totalUsage = addUsage(totalUsage, row.usage as Usage | null | undefined);
    totalDurationMs = addDurationMs(totalDurationMs, row.durationMs ?? null);
    hasError = hasError || Boolean(row.errorMessage) || details.some((tool) => tool.result?.isError);
    const toolCallsObjectKey = details.length > 0 ? `${toolCallsBaseObjectKey}${row.id}/tool-calls.json` : null;
    if (toolCallsObjectKey) {
      toolFiles.push({
        objectKey: toolCallsObjectKey,
        value: {
          version: 1,
          spaceId: input.spaceId,
          sessionId: input.sessionId,
          turnId: input.turnId,
          messageId: row.id,
          toolCalls: details,
        },
      });
    }
    messages.push({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as "user" | "assistant" | "system",
      content: summarizeIntermediateContent(content, details),
      text: row.text ?? null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      stopReason: row.stopReason ?? null,
      errorMessage: row.errorMessage ?? null,
      usage: row.usage as Usage | null,
      durationMs: row.durationMs ?? null,
      toolCallsObjectKey,
      meta: normalizeRecord(row.meta),
      createdAt: toIso(row.createdAt),
    });
  }

  const summary = {
    messageCount: messages.length,
    toolCallCount,
    usage: totalUsage,
    durationMs: totalDurationMs,
    lastMessageText: messages.at(-1)?.text ?? null,
    hasError,
  };
  if (messages.length === 0) return { index: null, summary };

  try {
    await writeTurnObjects(toolFiles);
    const messagesObjectKey = `${prefix}intermediate/messages.json`;
    const file: TurnIntermediateMessagesFile = {
      version: 1,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      summary,
      messages,
    };
    const written = await writeTurnObjectJson(messagesObjectKey, file);
    return {
      index: {
        version: 1 as const,
        messagesObjectKey,
        messagesSizeBytes: written.sizeBytes,
        toolCallsBaseObjectKey,
      },
      summary,
    };
  } catch (error) {
    logger.warn("[SessionTurn] failed to write intermediate objects", error);
    return { index: null, summary };
  }
};

async function finalizeSessionTurnFromMessage(input: { spaceId: string; sessionId: string; turnId: string; status: Exclude<SessionTurnStatus, "running">; assistantContent: ContentBlock[]; assistantText: string | null; provider: string | null; model: string | null; stopReason: string | null; errorMessage: string | null; usage: Usage | null; metaPatch?: Record<string, unknown> | null }) {
  const intermediate = await buildIntermediateObjectsForTurn(input);
  const completedAt = new Date();
  const completedAtIso = completedAt.toISOString();
  const [row] = await db.update(sessionTurns).set({
    status: input.status,
    assistantContent: input.assistantContent,
    assistantText: input.assistantText,
    provider: input.provider,
    model: input.model,
    stopReason: input.stopReason,
    errorMessage: input.errorMessage,
    finalUsage: input.usage,
    totalUsage: addUsage(intermediate?.summary.usage, input.usage),
    ...(input.metaPatch && Object.keys(input.metaPatch).length > 0 ? { meta: sql`coalesce(${sessionTurns.meta}, '{}'::jsonb) || ${JSON.stringify(input.metaPatch)}::jsonb` } : {}),
    summary: { text: input.assistantText, finishReason: input.status === "interrupted" ? "interrupted" : input.status === "failed" ? "failed" : "completed" },
    intermediateIndex: intermediate?.index ?? null,
    intermediateSummary: intermediate?.summary ?? null,
    completedAt,
    durationMs: sql<number>`greatest(0, floor(extract(epoch from (${completedAtIso}::timestamptz - ${sessionTurns.startedAt})) * 1000)::int)`,
    updatedAt: completedAt,
  }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.status, ["running", "abort_requested"]))).returning();
  return row ? toTurnRecord(row) : null;
}

async function dispatchFinalAssistantToGateway(input: { spaceId: string; sessionId: string; message: MessageRecord }) {
  if (input.message.role !== "assistant") return;
  const kind = input.message.meta?.messageKind;
  if (kind !== "assistant_final" && kind !== "assistant_error") return;

  const bindings = await db.select().from(spaceSessionBindings).where(eq(spaceSessionBindings.spaceSessionId, input.sessionId));
  const targetBindings = bindings.length > 0
    ? bindings.map((binding) => ({ spaceChannelId: binding.spaceChannelId, provider: binding.provider, externalChatId: binding.externalChatId, bindingKey: binding.bindingKey }))
    : (await db.select({ spaceChannelId: spaceChannels.id, provider: userChannels.provider, externalChatId: sql<string | null>`null`, bindingKey: sql<string>`''` }).from(spaceChannels).innerJoin(userChannels, eq(userChannels.id, spaceChannels.channelId)).where(eq(spaceChannels.spaceId, input.spaceId))).map((row) => ({ ...row, externalChatId: row.externalChatId ?? null }));

  for (const binding of targetBindings) {
    if (!binding.externalChatId) continue;
    const turnAnchorMessageId = typeof input.message.meta?.anchorUserMessageId === "string" ? input.message.meta.anchorUserMessageId : input.message.id;
    const [anchorRef] = await db.select({ externalMessageId: providerMessageRefs.externalMessageId }).from(providerMessageRefs).where(and(eq(providerMessageRefs.spaceChannelId, binding.spaceChannelId), eq(providerMessageRefs.sessionMessageId, turnAnchorMessageId), eq(providerMessageRefs.direction, "inbound"))).orderBy(desc(providerMessageRefs.createdAt)).limit(1);
    const command: GatewayOutboundCommand = {
      commandId: randomUUID(),
      timestamp: Date.now(),
      channelId: binding.spaceChannelId,
      provider: binding.provider as ChannelProvider,
      externalChatId: binding.externalChatId,
      content: input.message.content,
      replyToExternalMessageId: anchorRef?.externalMessageId,
      spaceId: input.spaceId,
      spaceSessionId: input.sessionId,
      sessionMessageId: input.message.id,
      meta: { sessionOutput: { type: "session.message.persisted", spaceId: input.spaceId, sessionId: input.sessionId, message: input.message }, bindingKey: binding.bindingKey, sessionMessageRole: input.message.role, turnAnchorMessageId },
    };
    await xaddWithMaxlen(redis, GATEWAY_OUTBOUND_STREAM, "*", "payload", JSON.stringify(command));
  }
}

async function notifyMessageSideEffects(input: { spaceId: string; sessionId: string; messageId: string }) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/messages/${input.messageId}/side-effects`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(env.WORKER_SECRET ? { "x-worker-secret": env.WORKER_SECRET } : {}), ...buildTraceHeaders({ requestId: getCurrentRequestId() }) },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API side effects failed ${response.status}: ${text}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function persistUserMessage(input: { spaceId: string; sessionId: string; userMessageId: string; turnId?: string | null; content: ContentBlock[]; meta?: Record<string, unknown> | null; startedAt?: string | null }) {
  const timing = completeMessageTiming({ startedAt: input.startedAt });
  const persisted = await persistMessageNode({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    previousMessageId: null,
    anchorUserMessageId: input.userMessageId,
    idempotencyKey: await buildUserIdempotencyKey({ messageId: input.userMessageId, content: input.content, meta: input.meta ?? null }),
    message: { id: input.userMessageId, role: "user", content: input.content, meta: { ...(input.meta ?? {}), turnId: input.turnId ?? (typeof input.meta?.turnId === "string" ? input.meta.turnId : null), messageId: input.userMessageId, clientMessageId: typeof input.meta?.clientMessageId === "string" ? input.meta.clientMessageId : null, agentSessionEntryId: typeof input.meta?.sessionEntryId === "string" ? input.meta.sessionEntryId : null }, provider: null, model: null, stopReason: null, errorMessage: null, usage: null, ...timing },
  });
  const record = toMessageRecord(persisted.message);
  if (!persisted.created) return { ok: true, message: record, created: false };
  await publishMessagePersisted(input.spaceId, record);
  const turnId = typeof record.meta?.turnId === "string" ? record.meta.turnId : null;
  if (turnId) {
    const [turnRow] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.id, turnId), eq(sessionTurns.sessionId, input.sessionId))).limit(1);
    if (turnRow) await publishTurnCreated(input.spaceId, toTurnRecord(turnRow)).catch((error) => logger.warn("[Realtime] failed to publish turn created", error));
  }
  return { ok: true, message: record };
}

const EMPTY_ASSISTANT_MESSAGE_ERROR = "LLM returned an empty assistant message after streaming completed.";

export async function persistAssistantMessage(input: { spaceId: string; spaceSessionId: string; userMessageId: string; event: Record<string, unknown>; userId?: string | null; turnId?: string | null; startedAt?: string | null; completedAt?: string | null }) {
  const assistantMessage = input.event.message;
  const toolResultsRaw = Array.isArray(input.event.toolResults) ? input.event.toolResults as Array<Record<string, unknown>> : [];
  if (!assistantMessage || typeof assistantMessage !== "object") {
    logger.warn("[Persist] turn_end event missing assistant message payload.");
    return;
  }
  const assistant = assistantMessage as Record<string, unknown>;
  const normalized = normalizeAssistantTurn(assistant, toolResultsRaw);
  const stopReason = typeof assistant.stopReason === "string" ? assistant.stopReason : null;
  const errorMessage = typeof assistant.errorMessage === "string" ? assistant.errorMessage : null;
  const hasAssistantError = stopReason === "error" || stopReason === "aborted" || Boolean(errorMessage);
  const isEmptySuccessfulAssistant = normalized.content.length === 0 && !hasAssistantError;
  const effectiveStopReason = isEmptySuccessfulAssistant ? "error" : stopReason;
  const effectiveErrorMessage = isEmptySuccessfulAssistant ? EMPTY_ASSISTANT_MESSAGE_ERROR : errorMessage;
  const timing = completeMessageTiming({ startedAt: input.startedAt, completedAt: input.completedAt });

  const message: PersistMessageInput["message"] = {
    role: "assistant",
    externalMessageId: typeof assistant.id === "string" ? assistant.id : null,
    protocolMessageId: typeof assistant.id === "string" ? assistant.id : null,
    content: normalized.content,
    provider: typeof assistant.provider === "string" ? assistant.provider : null,
    model: typeof assistant.model === "string" ? assistant.model : null,
    stopReason: effectiveStopReason,
    errorMessage: effectiveErrorMessage,
    meta: { ...(normalizeRecord(assistant.meta) ?? {}), turnId: input.turnId ?? null, spaceId: input.spaceId, sessionId: input.spaceSessionId, rawStopReason: stopReason, ...(isEmptySuccessfulAssistant ? { emptyAssistantMessageConvertedToError: true } : {}), thinking: normalized.thinking, thinkingSummary: normalized.thinkingSummary, toolCallRenderStates: normalized.toolCallRenderStates, agentSessionEntryId: typeof assistant.sessionEntryId === "string" ? assistant.sessionEntryId : null },
    usage: normalizeUsage(assistant.usage as PersistMessageInput["message"]["usage"]),
    ...timing,
  };
  const persisted = await persistMessageNode({ spaceId: input.spaceId, sessionId: input.spaceSessionId, previousMessageId: input.userMessageId, anchorUserMessageId: input.userMessageId, userId: input.userId ?? null, idempotencyKey: await buildAssistantIdempotencyKey({ previousMessageId: input.userMessageId, message }), message });
  const record = toMessageRecord(persisted.message);
  if (!persisted.created) {
    await notifyMessageSideEffects({ spaceId: input.spaceId, sessionId: input.spaceSessionId, messageId: record.id });
    return { ok: true, message: record, created: false };
  }
  await publishMessagePersisted(input.spaceId, record);
  if (record.meta?.messageKind === "assistant_final" || record.meta?.messageKind === "assistant_error") {
    const turnId = typeof record.meta.turnId === "string" ? record.meta.turnId : null;
    if (turnId) {
      const finalized = await finalizeSessionTurnFromMessage({ spaceId: input.spaceId, sessionId: input.spaceSessionId, turnId, status: effectiveStopReason === "aborted" ? "interrupted" : record.meta.messageKind === "assistant_error" ? "failed" : "completed", assistantContent: record.content, assistantText: record.text, provider: record.provider, model: record.model, stopReason: record.stopReason, errorMessage: record.errorMessage, usage: record.usage, metaPatch: { ...(typeof record.meta.agentSessionEntryId === "string" ? { agentSessionEntryId: record.meta.agentSessionEntryId } : {}), ...(typeof record.durationMs === "number" ? { finalMessageDurationMs: record.durationMs } : {}) } });
      if (finalized) await publishTurnFinalized(input.spaceId, finalized).catch((error) => logger.warn("[Realtime] failed to publish finalized turn", error));
    }
    await dispatchFinalAssistantToGateway({ spaceId: input.spaceId, sessionId: input.spaceSessionId, message: record }).catch((error) => logger.error("[GatewayOutbound] failed to dispatch assistant message", error));
    await notifyMessageSideEffects({ spaceId: input.spaceId, sessionId: input.spaceSessionId, messageId: record.id });
  }
  return { ok: true, message: record };
}

async function finalizeInterruptedTurn(input: { spaceId: string; sessionId: string; turnId: string; stopReason: "interrupted" | "aborted"; summary: Record<string, unknown> }) {
  const [existing] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId))).limit(1);
  if (!existing) return null;
  if (!["running", "abort_requested", "interrupted"].includes(existing.status)) return toTurnRecord(existing);
  const [last] = await db.select().from(sessionMessages).where(and(eq(sessionMessages.sessionId, input.sessionId), eq(sessionMessages.role, "assistant"), sql`${sessionMessages.meta}->>'turnId' = ${input.turnId}`)).orderBy(desc(sessionMessages.sequence)).limit(1);
  const intermediate = await buildIntermediateObjectsForTurn(input);
  const completedAt = new Date();
  const completedAtIso = completedAt.toISOString();
  const [row] = await db.update(sessionTurns).set({ status: "interrupted", assistantContent: last?.content ?? null, assistantText: last?.text ?? null, provider: last?.provider ?? null, model: last?.model ?? null, stopReason: input.stopReason, errorMessage: null, finalUsage: last?.usage as Usage | null ?? null, totalUsage: intermediate?.summary.usage ?? null, summary: input.summary, intermediateIndex: intermediate?.index ?? null, intermediateSummary: intermediate?.summary ?? null, completedAt, durationMs: sql<number>`greatest(0, floor(extract(epoch from (${completedAtIso}::timestamptz - ${sessionTurns.startedAt})) * 1000)::int)`, updatedAt: completedAt }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.status, ["running", "abort_requested", "interrupted"]))).returning();
  return row ? toTurnRecord(row) : null;
}

export async function interruptSessionTurn(input: { spaceId: string; sessionId: string; turnId: string; continuedByTurnId: string }) {
  const turn = await finalizeInterruptedTurn({ ...input, stopReason: "interrupted", summary: { finishReason: "interrupted", reason: "steer", continuedByTurnId: input.continuedByTurnId } });
  if (turn) await publishTurnFinalized(input.spaceId, turn);
  return turn;
}

export async function abortSessionTurn(input: { spaceId: string; sessionId: string; turnId: string; actorUserId?: string | null }) {
  const turn = await finalizeInterruptedTurn({ ...input, stopReason: "aborted", summary: { finishReason: "interrupted", reason: "abort" } });
  if (turn) await publishTurnFinalized(input.spaceId, turn);
  return turn;
}

export async function failSessionTurn(input: { spaceId: string; sessionId: string; turnId: string; errorMessage: string }) {
  const completedAt = new Date();
  const completedAtIso = completedAt.toISOString();
  const [row] = await db.update(sessionTurns).set({ status: "failed", errorMessage: input.errorMessage, summary: { finishReason: "failed", text: input.errorMessage }, completedAt, durationMs: sql<number>`greatest(0, floor(extract(epoch from (${completedAtIso}::timestamptz - ${sessionTurns.startedAt})) * 1000)::int)`, updatedAt: completedAt }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.status, ["queued", "running", "abort_requested"]))).returning();
  const turn = row ? toTurnRecord(row) : null;
  if (turn) await publishTurnFinalized(input.spaceId, turn);
  return turn;
}
