import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { ContentBlock, Usage } from "@neta-art/cohub-protocol/core";
import type {
  MessageToolCallsFile,
  SessionTurnIntent,
  SessionTurnRecord,
  SessionTurnStatus,
  StoredIntermediateMessage,
  StoredIntermediateMessageToolCallSummary,
  StoredToolCall,
  TurnIntermediateMessagesFile,
} from "@neta-art/cohub-protocol/model";
import { db } from "./db/index.js";
import { sessionMessages, sessionTurns } from "./db/schema-v2.js";
import { buildTurnObjectPrefix, assertTurnObjectKeyInScope, createTurnObjectCdnUrl, writeTurnObjectJson } from "./turn-object-storage.js";
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

const summarizeToolInput = (input: Record<string, unknown>) => {
  try {
    const text = JSON.stringify(input);
    if (text.length <= 1200) return input;
    return { preview: `${text.slice(0, 1199)}…` };
  } catch {
    return { preview: String(input).slice(0, 1200) };
  }
};

const extractToolCalls = (content: ContentBlock[]): { summaries: StoredIntermediateMessageToolCallSummary[]; details: StoredToolCall[] } => {
  const byId = new Map<string, StoredToolCall>();
  for (const block of content) {
    if (block.type === "tool_use") {
      byId.set(block.id, {
        id: block.id,
        name: block.name,
        input: block.input,
        result: null,
        meta: normalizeRecord(block._meta),
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
          },
        });
      }
    }
  }
  const details = [...byId.values()];
  const summaries = details.map((tool): StoredIntermediateMessageToolCallSummary => ({
    id: tool.id,
    name: tool.name,
    status: tool.result ? (tool.result.isError ? "failed" : "done") : "running",
    input: summarizeToolInput(tool.input),
  }));
  return { summaries, details };
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
    rows = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), sql`${sessionTurns.sequence} <= ${options.cursor}`)).orderBy(desc(sessionTurns.sequence)).limit(limit);
    return rows.reverse().map(toTurnRecord);
  }
  rows = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), gt(sessionTurns.sequence, options.cursor))).orderBy(asc(sessionTurns.sequence)).limit(limit);
  return rows.map(toTurnRecord);
};

export const getSessionTurnById = async (sessionId: string, turnId: string) => {
  const [row] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.id, turnId))).limit(1);
  return row ? toTurnRecord(row) : null;
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
  let toolCallCount = 0;
  let hasError = false;

  const messages: StoredIntermediateMessage[] = [];
  for (const row of intermediateRows) {
    const content = row.content as ContentBlock[];
    const { summaries, details } = extractToolCalls(content);
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
      content,
      text: row.text ?? null,
      provider: row.provider ?? null,
      model: row.model ?? null,
      stopReason: row.stopReason ?? null,
      errorMessage: row.errorMessage ?? null,
      usage: row.usage as Usage | null,
      toolCalls: summaries,
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
  const prefix = buildTurnObjectPrefix(input);
  return input.objectKeys.map((objectKey) => createTurnObjectCdnUrl(
    assertTurnObjectKeyInScope({ objectKey, prefix }),
  ));
};
