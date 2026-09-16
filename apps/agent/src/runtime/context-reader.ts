import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { sessionMessages, sessionTurns, sessionTurnSegments, spaceSessions } from "@cohub/db";
import { harnessArchiveSchema, selectRuntimeContextMessages, type HarnessKind, type RuntimeContext, type RuntimeContextMessage } from "@cohub/protocol";
import type { db } from "../db.js";
import type { HarnessArchiveIndex } from "@cohub/protocol";
type ArchiveReader = (index: HarnessArchiveIndex, scope: { spaceId: string; sessionId: string; turnId: string }) => Promise<unknown>;

type ContextInput = { spaceId: string; sessionId: string; beforeSequence?: number; throughTurnId?: string; harness?: HarnessKind; headOnly?: boolean; pendingTurnIds?: string[] };
type ContextDatabase = Pick<typeof db, "select">;
const asMeta = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** The hot path reads indexed boundary rows, never the complete conversation. */
export function createRuntimeContextReader(database: ContextDatabase, readArchive: ArchiveReader, onArchiveError: (turnId: string, error: unknown) => void = () => {}) {
  return async function load(input: ContextInput): Promise<RuntimeContext> {
    const [session] = await database.select({ id: spaceSessions.id }).from(spaceSessions)
      .where(and(eq(spaceSessions.id, input.sessionId), eq(spaceSessions.spaceId, input.spaceId))).limit(1);
    if (!session) throw new Error("Session does not belong to Space");
    let beforeSequence = input.beforeSequence;
    if (input.throughTurnId) {
      const [turn] = await database.select({ sequence: sessionTurns.sequence }).from(sessionTurns)
        .where(and(eq(sessionTurns.id, input.throughTurnId), eq(sessionTurns.sessionId, input.sessionId))).limit(1);
      if (!turn) throw new Error("Context boundary turn not found");
      beforeSequence = turn.sequence + 1;
    }
    const segments = await database.select().from(sessionTurnSegments).where(eq(sessionTurnSegments.sessionId, input.sessionId)).orderBy(asc(sessionTurnSegments.ordinal));
    const ranges = (segments.length ? segments : [{ sourceSessionId: input.sessionId, fromSequence: 1, toSequence: null }]).filter((range) => beforeSequence == null || range.fromSequence < beforeSequence);
    const predicate = (range: typeof ranges[number]) => and(
      eq(sessionTurns.sessionId, range.sourceSessionId), gte(sessionTurns.sequence, range.fromSequence),
      range.toSequence == null ? undefined : lte(sessionTurns.sequence, range.toSequence),
      beforeSequence == null ? undefined : lt(sessionTurns.sequence, beforeSequence), ne(sessionTurns.status, "queued"),
    );
    const heads = await Promise.all(ranges.map(async (range) => {
      const [head] = await database.select({ id: sessionTurns.id, sessionId: sessionTurns.sessionId, sequence: sessionTurns.sequence, status: sessionTurns.status, updatedAt: sessionTurns.updatedAt, harnessIndex: sessionTurns.harnessIndex, recoveryState: sql<string | null>`${sessionTurns.meta}->'runtimeRecovery'->>'state'` })
        .from(sessionTurns).where(predicate(range)).orderBy(desc(sessionTurns.sequence)).limit(1);
      return head ?? null;
    }));
    const lastTurn = heads.filter((head) => head !== null).at(-1) ?? null;
    if (heads.some((head) => head && ["running", "abort_requested"].includes(head.status))) throw new Error("Cannot resume before an earlier turn has settled");
    const revision = createHash("sha256").update(JSON.stringify(ranges.map((range, index) => [range.sourceSessionId, range.fromSequence, range.toSequence, heads[index]?.id, heads[index]?.sequence, heads[index]?.updatedAt]))).digest("hex");
    const result: RuntimeContext = { complete: !input.headOnly, revision, throughTurnId: lastTurn?.id ?? null, messages: [], resolvedTurnIds: [], settledTurnIds: [] };
    if (input.pendingTurnIds?.length) {
      if (input.pendingTurnIds.length > 2) throw new Error("Too many pending Runtime projections");
      const settled = await database.select({ id: sessionTurns.id, recoveryState: sql<string | null>`${sessionTurns.meta}->'runtimeRecovery'->>'state'` }).from(sessionTurns)
        .where(and(eq(sessionTurns.sessionId, input.sessionId), inArray(sessionTurns.id, input.pendingTurnIds),
          beforeSequence == null ? undefined : lt(sessionTurns.sequence, beforeSequence),
          inArray(sessionTurns.status, ["completed", "failed", "interrupted"])));
      result.resolvedTurnIds = settled.filter((turn) => turn.recoveryState === "confirmed_stopped").map((turn) => turn.id);
      result.settledTurnIds = settled.filter((turn) => turn.recoveryState !== "confirmed_stopped").map((turn) => turn.id);
    }
    if (input.headOnly) return result;

    for (const range of ranges) {
      const turns = await database.select().from(sessionTurns).where(predicate(range)).orderBy(asc(sessionTurns.sequence));
      if (turns.some((turn) => ["running", "abort_requested"].includes(turn.status))) throw new Error("Cannot resume before an earlier turn has settled");
      // Legacy messages may have meta.turnId but no indexed turn_id yet.
      const rows = await database.select({ message: sessionMessages, turnId: sessionTurns.id, turnMeta: sessionTurns.meta, turnSequence: sessionTurns.sequence }).from(sessionMessages)
        .innerJoin(sessionTurns, or(eq(sessionMessages.turnId, sessionTurns.id), and(isNull(sessionMessages.turnId), sql`${sessionMessages.meta}->>'turnId' = ${sessionTurns.id}::text`)))
        .where(and(predicate(range), eq(sessionMessages.sessionId, sessionTurns.sessionId)))
        .orderBy(asc(sessionMessages.sequence));
      const present = new Set(rows.map((row) => row.turnId));
      const fallback = turns.filter((turn) => !present.has(turn.id) && turn.status !== "cancelled");
      let fallbackIndex = 0;
      const appendFallback = (turn: typeof turns[number]) => {
        const meta = asMeta(turn.meta);
        if (turn.userContent.length) result.messages.push({ id: typeof meta.userMessageId === "string" ? meta.userMessageId : `${turn.id}:user`, turnId: turn.id, role: "user", content: turn.userContent });
        if (turn.assistantContent?.length) result.messages.push({ id: `${turn.id}:assistant`, turnId: turn.id, role: turn.intent === "compact" ? "system" : "assistant", content: turn.assistantContent, provider: turn.provider, model: turn.model, meta: { compaction: meta.compaction, createdAt: turn.createdAt?.toISOString() } });
      };
      for (const { message, turnId, turnMeta, turnSequence } of rows) {
        while (fallback[fallbackIndex]?.sequence !== undefined && (fallback[fallbackIndex]?.sequence ?? Number.POSITIVE_INFINITY) < turnSequence) {
          const turn = fallback[fallbackIndex];
          fallbackIndex += 1;
          if (turn) appendFallback(turn);
        }
        const meta = asMeta(message.meta);
        const shellResult = asMeta(turnMeta).intent === "shell_command" && message.role === "assistant";
        result.messages.push({
          id: message.id, turnId, role: message.role as RuntimeContextMessage["role"], content: message.content,
          provider: message.provider, model: message.model,
          meta: { agentSessionEntryId: meta.agentSessionEntryId ?? null, messageKind: shellResult ? "shell_command_result" : meta.messageKind,
            compaction: meta.compaction, generationTaskId: meta.generationTaskId, generationStatus: meta.generationStatus,
            command: meta.command, llmContextText: meta.llmContextText, createdAt: message.createdAt?.toISOString(),
          },
        });
      }
      while (fallback[fallbackIndex]) {
        const turn = fallback[fallbackIndex];
        fallbackIndex += 1;
        if (turn) appendFallback(turn);
      }
    }
    result.messages = selectRuntimeContextMessages(result.messages);
    const index = lastTurn?.harnessIndex;
    if (input.harness && index?.harness === input.harness && lastTurn && lastTurn.recoveryState !== "confirmed_stopped") {
      try {
        const archived = harnessArchiveSchema.parse(await readArchive(index, { spaceId: input.spaceId, sessionId: lastTurn.sessionId, turnId: lastTurn.id }));
        if (archived.turnId !== lastTurn.id || archived.sessionId !== lastTurn.sessionId || archived.harness !== input.harness) throw new Error("Harness archive identity mismatch");
        result.archive = archived;
      } catch (error) { onArchiveError(lastTurn.id, error); }
    }
    return result;
  };
}
