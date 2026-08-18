import { and, eq, inArray, sql } from "drizzle-orm";
import { sessionMessages, sessionTurns, spaceSessions, taskRuns } from "@cohub/db";
import { buildGenerationResultMessage } from "@cohub/protocol/generation";
import type { GenerationContentBlock, GenerationTaskResult } from "@cohub/protocol/generation";
import type { TaskPayload } from "@cohub/protocol/task";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import { sanitizeContentBlocksForPostgresJson } from "@cohub/core/content/sanitize";
import { db } from "../db.js";
import { wakeAgentSession } from "../session-services.js";
import { dispatchSessionUpdated, dispatchTurnUpdated } from "../realtime-events.js";

const toIso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function toTurnRecord(row: typeof sessionTurns.$inferSelect): SessionTurnRecord {
  return {
    id: row.id, sessionId: row.sessionId, userUuid: row.userUuid ?? null, sequence: row.sequence,
    executionKind: row.executionKind, status: row.status, intent: row.intent,
    userContent: row.userContent, userText: row.userText ?? null,
    assistantContent: row.assistantContent ?? null, assistantText: row.assistantText ?? null,
    provider: row.provider ?? null, model: row.model ?? null, stopReason: row.stopReason ?? null,
    errorMessage: row.errorMessage ?? null, finalUsage: row.finalUsage ?? null, totalUsage: row.totalUsage ?? null,
    summary: row.summary ?? null, intermediateIndex: row.intermediateIndex ?? null,
    intermediateSummary: row.intermediateSummary ?? null,
    meta: row.meta && typeof row.meta === "object" && !Array.isArray(row.meta) ? row.meta as Record<string, unknown> : null,
    startedAt: toIso(row.startedAt), completedAt: toIso(row.completedAt), durationMs: row.durationMs ?? null,
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(), updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function textFromContent(content: Array<{ type: string; text?: string }>) {
  return content
    .flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n")
    .trim() || null;
}

function generationInput(payload: TaskPayload) {
  const data = payload.data ?? {};
  return {
    model: typeof data.model === "string" ? data.model : "unknown",
    parameters: data.parameters && typeof data.parameters === "object" && !Array.isArray(data.parameters)
      ? data.parameters as Record<string, unknown>
      : {},
    content: Array.isArray(data.content) ? data.content as GenerationContentBlock[] : [],
  };
}

export async function markGenerationSessionRunning(taskRunId: string) {
  const [task] = await db.select({ spaceId: taskRuns.spaceId, sessionId: taskRuns.sessionId, turnId: taskRuns.turnId }).from(taskRuns).where(eq(taskRuns.id, taskRunId)).limit(1);
  if (!task?.spaceId || !task.sessionId || !task.turnId) return;
  const [turn] = await db.update(sessionTurns).set({ status: "running", startedAt: new Date(), updatedAt: new Date() }).where(and(eq(sessionTurns.id, task.turnId), eq(sessionTurns.sessionId, task.sessionId), eq(sessionTurns.executionKind, "direct_generation"), inArray(sessionTurns.status, ["queued", "running"]))).returning();
  if (turn) await dispatchTurnUpdated({ spaceId: task.spaceId, turn: toTurnRecord(turn) });
}

export async function finalizeGenerationSession(input: { taskRunId: string; payload: TaskPayload; result: GenerationTaskResult }) {
  const sessionId = input.payload.sessionId;
  const turnId = input.payload.turnId;
  if (!sessionId || !turnId) return;
  const request = generationInput(input.payload);
  const output = buildGenerationResultMessage({
    taskId: input.taskRunId,
    model: input.result.model || request.model,
    parameters: request.parameters,
    status: "completed",
    result: input.result.output,
  });
  const content = sanitizeContentBlocksForPostgresJson(output.content);
  const text = textFromContent(content);
  const completedAt = new Date();

  const updatedTurn = await db.transaction(async (tx) => {
    const [turn] = await tx.update(sessionTurns).set({
      status: "completed",
      assistantContent: content,
      assistantText: text,
      model: input.result.model || request.model,
      summary: { text, finishReason: "completed" },
      completedAt,
      updatedAt: completedAt,
      meta: sql`coalesce(${sessionTurns.meta}, '{}'::jsonb) || ${JSON.stringify({ generationTaskId: input.taskRunId })}::jsonb`,
    }).where(and(eq(sessionTurns.id, turnId), eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.executionKind, "direct_generation"), inArray(sessionTurns.status, ["queued", "running"]))).returning();
    if (!turn) return { turn: null, session: null };

    const [existing] = await tx.select({ id: sessionMessages.id }).from(sessionMessages).where(and(eq(sessionMessages.sessionId, sessionId), eq(sessionMessages.idempotencyKey, `generation:${input.taskRunId}:result`))).limit(1);
    if (existing) {
      await tx.update(sessionMessages).set({ content, text, model: input.result.model || request.model, meta: { ...output.meta, messageKind: "generation_result", turnId, generationTaskId: input.taskRunId, generationStatus: "completed" }, completedAt }).where(eq(sessionMessages.id, existing.id));
    } else {
      const [sequence] = await tx.select({ max: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)::int` }).from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
      await tx.insert(sessionMessages).values({ sessionId, turnId, role: "assistant", content, text, model: input.result.model || request.model, sequence: (sequence?.max ?? 0) + 1, idempotencyKey: `generation:${input.taskRunId}:result`, meta: { ...output.meta, messageKind: "generation_result", turnId, generationTaskId: input.taskRunId, generationStatus: "completed" }, completedAt });
    }
    const [session] = await tx.update(spaceSessions).set({ latestMessageText: text, lastMessageAt: completedAt, updatedAt: completedAt }).where(eq(spaceSessions.id, sessionId)).returning();
    return { turn, session: session ?? null };
  });
  if (updatedTurn.turn && input.payload.spaceId) await dispatchTurnUpdated({ spaceId: input.payload.spaceId, turn: toTurnRecord(updatedTurn.turn) }).catch(() => undefined);
  if (updatedTurn.session) await dispatchSessionUpdated({ session: updatedTurn.session, changed: ["latestMessageText", "lastMessageAt", "updatedAt"] }).catch(() => undefined);
  await wakeAgentSession(input.payload.spaceId ?? "", sessionId, "generation_complete").catch(() => undefined);
}

export async function failGenerationSession(input: { taskRunId: string; payload: TaskPayload; error: unknown }) {
  const sessionId = input.payload.sessionId;
  const turnId = input.payload.turnId;
  if (!sessionId || !turnId) return;
  const request = generationInput(input.payload);
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const output = buildGenerationResultMessage({
    taskId: input.taskRunId,
    model: request.model,
    parameters: request.parameters,
    status: "failed",
    error: { message },
  });
  const content = sanitizeContentBlocksForPostgresJson(output.content);
  const completedAt = new Date();
  const text = textFromContent(content);
  const updatedTurn = await db.transaction(async (tx) => {
    const [turn] = await tx.update(sessionTurns).set({ status: "failed", assistantContent: content, assistantText: text, model: request.model, errorMessage: message, summary: { text, finishReason: "failed" }, completedAt, updatedAt: completedAt }).where(and(eq(sessionTurns.id, turnId), eq(sessionTurns.sessionId, sessionId), eq(sessionTurns.executionKind, "direct_generation"), inArray(sessionTurns.status, ["queued", "running"]))).returning();
    if (!turn) return { turn: null, session: null };

    const [existing] = await tx.select({ id: sessionMessages.id }).from(sessionMessages).where(and(eq(sessionMessages.sessionId, sessionId), eq(sessionMessages.idempotencyKey, `generation:${input.taskRunId}:result`))).limit(1);
    if (existing) {
      await tx.update(sessionMessages).set({ content, text, model: request.model, meta: { ...output.meta, messageKind: "generation_result", turnId, generationTaskId: input.taskRunId, generationStatus: "failed" }, completedAt }).where(eq(sessionMessages.id, existing.id));
    } else {
      const [sequence] = await tx.select({ max: sql<number>`coalesce(max(${sessionMessages.sequence}), 0)::int` }).from(sessionMessages).where(eq(sessionMessages.sessionId, sessionId));
      await tx.insert(sessionMessages).values({ sessionId, turnId, role: "assistant", content, text, model: request.model, sequence: (sequence?.max ?? 0) + 1, idempotencyKey: `generation:${input.taskRunId}:result`, meta: { ...output.meta, messageKind: "generation_result", turnId, generationTaskId: input.taskRunId, generationStatus: "failed" }, completedAt });
    }
    const [session] = await tx.update(spaceSessions).set({ latestMessageText: text, lastMessageAt: completedAt, updatedAt: completedAt }).where(eq(spaceSessions.id, sessionId)).returning();
    return { turn, session: session ?? null };
  });
  if (updatedTurn.turn && input.payload.spaceId) await dispatchTurnUpdated({ spaceId: input.payload.spaceId, turn: toTurnRecord(updatedTurn.turn) }).catch(() => undefined);
  if (updatedTurn.session) await dispatchSessionUpdated({ session: updatedTurn.session, changed: ["latestMessageText", "lastMessageAt", "updatedAt"] }).catch(() => undefined);
  await wakeAgentSession(input.payload.spaceId ?? "", sessionId, "generation_failed").catch(() => undefined);
}
