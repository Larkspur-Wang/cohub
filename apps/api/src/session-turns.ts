import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { ContentBlock, Usage } from "@neta-art/cohub-protocol/core";
import type {
  MessageToolCallsFile,
  SessionTurnIndexItem,
  SessionTurnIntent,
  SessionTurnRecord,
  SessionTurnStatus,
  StoredIntermediateMessage,
  StoredToolCall,
  TurnIntermediateMessagesFile,
} from "@neta-art/cohub-protocol/model";
import { db } from "./db/index.js";
import { sessionMessages, sessionTurns } from "./db/schema-v2.js";
import { buildTurnObjectPrefix, assertTurnObjectKeyForTurn, createTurnObjectCdnUrl, writeTurnObjectJson } from "./turn-object-storage.js";
import { deriveMessagePreviewText } from "./space-sessions.js";

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
};

const normalizeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

const addUsage = (a: Usage | null | undefined, b: Usage | null | undefined): Usage | null => {
  if (!a && !b) return null;
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0) || undefined,
    output: (a?.output ?? 0) + (b?.output ?? 0) || undefined,
    cacheRead: (a?.cacheRead ?? 0) + (b?.cacheRead ?? 0) || undefined,
    cacheWrite: (a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0) || undefined,
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0) || undefined,
    cost: (a?.cost || b?.cost)
      ? {
          input: ((a?.cost?.input ?? 0) + (b?.cost?.input ?? 0)) || undefined,
          output: ((a?.cost?.output ?? 0) + (b?.cost?.output ?? 0)) || undefined,
          cacheRead: ((a?.cost?.cacheRead ?? 0) + (b?.cost?.cacheRead ?? 0)) || undefined,
          cacheWrite: ((a?.cost?.cacheWrite ?? 0) + (b?.cost?.cacheWrite ?? 0)) || undefined,
          total: ((a?.cost?.total ?? 0) + (b?.cost?.total ?? 0)) || undefined,
        }
      : null,
  };
};

const truncateText = (text: string, limit: number) => {
  if (text.length <= limit) return { value: text, truncated: false, originalLength: text.length };
  return { value: `${text.slice(0, Math.max(0, limit - 1))}…`, truncated: true, originalLength: text.length };
};

const previewText = (value: string | null | undefined, limit = 160) => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return truncateText(normalized, limit).value;
};

const summarizeValue = (value: unknown, limit = 240): unknown => {
  if (typeof value === "string") {
    const truncated = truncateText(value, limit);
    return truncated.truncated
      ? { preview: truncated.value, _truncated: true, originalLength: truncated.originalLength }
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  try {
    const text = JSON.stringify(value);
    const truncated = truncateText(text, limit);
    return {
      preview: truncated.value,
      ...(truncated.truncated ? { _truncated: true, originalLength: truncated.originalLength } : {}),
    };
  } catch {
    const text = String(value);
    const truncated = truncateText(text, limit);
    return {
      preview: truncated.value,
      ...(truncated.truncated ? { _truncated: true, originalLength: truncated.originalLength } : {}),
    };
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
  usage: row.usage ?? null,
  summary: row.summary ?? null,
  intermediateIndex: row.intermediateIndex ?? null,
  intermediateSummary: row.intermediateSummary ?? null,
  meta: normalizeRecord(row.meta),
  startedAt: row.startedAt ? toIso(row.startedAt) : null,
  completedAt: row.completedAt ? toIso(row.completedAt) : null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

type SessionTurnIndexRow = {
  id: string;
  sessionId: string;
  sequence: number;
  status: SessionTurnStatus;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  userText: string | null;
  assistantText: string | null;
  provider: string | null;
  model: string | null;
  usage: Usage | null;
  errorMessage: string | null;
};

const toTurnIndexItem = (row: SessionTurnIndexRow): SessionTurnIndexItem => ({
  id: row.id,
  sessionId: row.sessionId,
  sequence: row.sequence,
  status: row.status,
  startedAt: row.startedAt ? toIso(row.startedAt) : null,
  completedAt: row.completedAt ? toIso(row.completedAt) : null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  userPreview: previewText(row.userText),
  assistantPreview: previewText(row.assistantText),
  provider: row.provider ?? null,
  model: row.model ?? null,
  usage: row.usage ?? null,
  errorMessage: previewText(row.errorMessage, 220),
});

export const createSessionTurn = async (input: {
  id: string;
  sessionId: string;
  userUuid: string | null;
  userContent: ContentBlock[];
  intent?: SessionTurnIntent;
  meta?: Record<string, unknown> | null;
}) => {
  const userText = deriveMessagePreviewText({ role: "user", content: input.userContent }) || null;
  const [row] = await db.transaction(async (tx) => {
    const [sessionRow] = await tx.execute(sql`select id from v2.space_sessions where id = ${input.sessionId} for update`);
    if (!sessionRow) throw new Error("session not found");
    const [seqRow] = await tx.select({ max: sql<number>`coalesce(max(${sessionTurns.sequence}), 0)::int` }).from(sessionTurns).where(eq(sessionTurns.sessionId, input.sessionId));
    const sequence = (seqRow?.max ?? 0) + 1;
    return tx.insert(sessionTurns).values({
      id: input.id,
      sessionId: input.sessionId,
      userUuid: input.userUuid,
      sequence,
      status: "running",
      intent: input.intent ?? "steer",
      userContent: input.userContent,
      userText,
      meta: input.meta ?? null,
    }).returning();
  });
  if (!row) throw new Error("failed to create session turn");
  return toTurnRecord(row);
};

export const listSessionTurns = async (sessionId: string, options?: { cursor?: number; limit?: number; direction?: "older" | "newer" }) => {
  const limit = Math.min(options?.limit ?? 30, 100);
  const direction = options?.direction ?? "older";
  let rows: Array<typeof sessionTurns.$inferSelect>;
  if (options?.cursor == null) {
    rows = await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, sessionId)).orderBy(desc(sessionTurns.sequence)).limit(limit);
    return rows.reverse().map(toTurnRecord);
  }
  if (direction === "older") {
    rows = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), lt(sessionTurns.sequence, options.cursor))).orderBy(desc(sessionTurns.sequence)).limit(limit);
    return rows.reverse().map(toTurnRecord);
  }
  rows = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), gt(sessionTurns.sequence, options.cursor))).orderBy(asc(sessionTurns.sequence)).limit(limit);
  return rows.map(toTurnRecord);
};

export const listSessionTurnIndex = async (sessionId: string, options?: { cursor?: number; limit?: number }) => {
  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 200), 1), 500);
  const rows = await db.select({
    id: sessionTurns.id,
    sessionId: sessionTurns.sessionId,
    sequence: sessionTurns.sequence,
    status: sessionTurns.status,
    startedAt: sessionTurns.startedAt,
    completedAt: sessionTurns.completedAt,
    createdAt: sessionTurns.createdAt,
    updatedAt: sessionTurns.updatedAt,
    userText: sessionTurns.userText,
    assistantText: sessionTurns.assistantText,
    provider: sessionTurns.provider,
    model: sessionTurns.model,
    usage: sessionTurns.usage,
    errorMessage: sessionTurns.errorMessage,
  }).from(sessionTurns).where(
    options?.cursor == null
      ? eq(sessionTurns.sessionId, sessionId)
      : and(eq(sessionTurns.sessionId, sessionId), gt(sessionTurns.sequence, options.cursor)),
  ).orderBy(asc(sessionTurns.sequence)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    turns: pageRows.map(toTurnIndexItem),
    hasMore,
    nextCursor: pageRows.at(-1)?.sequence,
  };
};

export const getSessionTurnSequenceById = async (sessionId: string, turnId: string) => {
  const [row] = await db.select({ sequence: sessionTurns.sequence }).from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.id, turnId))).limit(1);
  return row?.sequence ?? null;
};

export const listSessionTurnWindow = async (sessionId: string, input: { sequence: number; before?: number; after?: number }) => {
  const before = Math.min(Math.max(Math.floor(input.before ?? 10), 0), 100);
  const after = Math.min(Math.max(Math.floor(input.after ?? 20), 0), 100);
  const [anchor] = await db.select({ id: sessionTurns.id }).from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.sequence, input.sequence))).limit(1);
  if (!anchor) return null;
  const [olderRows, anchorAndNewerRows] = await Promise.all([
    before > 0
      ? db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), lt(sessionTurns.sequence, input.sequence))).orderBy(desc(sessionTurns.sequence)).limit(before + 1)
      : Promise.resolve([] as Array<typeof sessionTurns.$inferSelect>),
    db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), gt(sessionTurns.sequence, input.sequence - 1))).orderBy(asc(sessionTurns.sequence)).limit(after + 2),
  ]);
  const hasMoreOlder = olderRows.length > before;
  const older = (hasMoreOlder ? olderRows.slice(0, before) : olderRows).reverse();
  const hasMoreNewer = anchorAndNewerRows.length > after + 1;
  const anchorAndNewer = hasMoreNewer ? anchorAndNewerRows.slice(0, after + 1) : anchorAndNewerRows;
  const turns = [...older, ...anchorAndNewer].map(toTurnRecord);
  return {
    turns,
    hasMoreOlder,
    hasMoreNewer,
    oldestCursor: turns[0]?.sequence,
    newestCursor: turns.at(-1)?.sequence,
    anchorSequence: anchorAndNewer[0]?.sequence,
  };
};

export const getSessionTurnById = async (sessionId: string, turnId: string) => {
  const [row] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.id, turnId))).limit(1);
  return row ? toTurnRecord(row) : null;
};

export const buildIntermediateObjectsForTurn = async (input: { spaceId: string; sessionId: string; turnId: string }) => {
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
  let toolCallCount = 0;
  let hasError = false;

  const messages: StoredIntermediateMessage[] = [];
  for (const row of intermediateRows) {
    const content = row.content as ContentBlock[];
    const details = extractToolCalls(content);
    toolCallCount += details.length;
    totalUsage = addUsage(totalUsage, row.usage as Usage | null | undefined);
    hasError = hasError || Boolean(row.errorMessage) || details.some((tool) => tool.result?.isError);
    const toolCallsObjectKey = details.length > 0 ? `${toolCallsBaseObjectKey}${row.id}/tool-calls.json` : null;
    if (toolCallsObjectKey) {
      const toolFile: MessageToolCallsFile = {
        version: 1,
        spaceId: input.spaceId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        messageId: row.id,
        toolCalls: details,
      };
      await writeTurnObjectJson(toolCallsObjectKey, toolFile);
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
      toolCallsObjectKey,
      meta: normalizeRecord(row.meta),
      createdAt: toIso(row.createdAt),
    });
  }

  const summary = {
    messageCount: messages.length,
    toolCallCount,
    usage: totalUsage,
    lastMessageText: messages.at(-1)?.text ?? null,
    hasError,
  };
  if (messages.length === 0) {
    return {
      index: null,
      summary,
    };
  }
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
};

export const failSessionTurn = async (input: { sessionId: string; turnId: string; errorMessage: string }) => {
  const [row] = await db.update(sessionTurns).set({
    status: "failed",
    errorMessage: input.errorMessage,
    summary: { finishReason: "failed", text: input.errorMessage },
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId), eq(sessionTurns.status, "running"))).returning();
  return row ? toTurnRecord(row) : null;
};

export const finalizeSessionTurnFromMessage = async (input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  status: Exclude<SessionTurnStatus, "running" | "interrupted">;
  assistantContent: ContentBlock[];
  assistantText: string | null;
  provider: string | null;
  model: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  usage: Usage | null;
}) => {
  const intermediate = await buildIntermediateObjectsForTurn(input).catch((error) => {
    console.warn("[SessionTurn] failed to build intermediate objects", error);
    return null;
  });
  const [row] = await db.update(sessionTurns).set({
    status: input.status,
    assistantContent: input.assistantContent,
    assistantText: input.assistantText,
    provider: input.provider,
    model: input.model,
    stopReason: input.stopReason,
    errorMessage: input.errorMessage,
    usage: addUsage(intermediate?.summary.usage, input.usage),
    summary: {
      text: input.assistantText,
      finishReason: input.status === "failed" ? "failed" : "completed",
    },
    intermediateIndex: intermediate?.index ?? null,
    intermediateSummary: intermediate?.summary ?? null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId))).returning();
  return row ? toTurnRecord(row) : null;
};

export const interruptSessionTurn = async (input: { spaceId: string; sessionId: string; turnId: string; interruptedByTurnId: string }) => {
  const [existing] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId))).limit(1);
  if (!existing || existing.status !== "running") return existing ? toTurnRecord(existing) : null;
  const rows = await db.select().from(sessionMessages).where(and(
    eq(sessionMessages.sessionId, input.sessionId),
    eq(sessionMessages.role, "assistant"),
    sql`${sessionMessages.meta}->>'turnId' = ${input.turnId}`,
  )).orderBy(desc(sessionMessages.sequence)).limit(1);
  const last = rows[0] ?? null;
  const intermediate = await buildIntermediateObjectsForTurn(input).catch((error) => {
    console.warn("[SessionTurn] failed to build interrupted intermediate objects", error);
    return null;
  });
  const [row] = await db.update(sessionTurns).set({
    status: "interrupted",
    assistantContent: last?.content ?? null,
    assistantText: last?.text ?? null,
    provider: last?.provider ?? null,
    model: last?.model ?? null,
    stopReason: "interrupted",
    errorMessage: null,
    usage: intermediate?.summary.usage ?? null,
    summary: {
      finishReason: "interrupted",
      interruptedByTurnId: input.interruptedByTurnId,
    },
    intermediateIndex: intermediate?.index ?? null,
    intermediateSummary: intermediate?.summary ?? null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(eq(sessionTurns.id, input.turnId), eq(sessionTurns.sessionId, input.sessionId))).returning();
  return row ? toTurnRecord(row) : null;
};

export const createSignedTurnUrls = async (input: { spaceId: string; sessionId: string; turnId: string; objectKeys: string[] }) => {
  return Object.fromEntries(input.objectKeys.map((objectKey) => [
    objectKey,
    createTurnObjectCdnUrl(assertTurnObjectKeyForTurn({
      objectKey,
      spaceId: input.spaceId,
      sessionId: input.sessionId,
      turnId: input.turnId,
    })).url,
  ]));
};
