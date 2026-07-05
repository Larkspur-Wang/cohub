import { and, asc, eq, sql } from "drizzle-orm";
import type { ContentBlock } from "@cohub/protocol/core";
import type { SessionTurnRecord } from "@cohub/protocol/model";
import { sessionMessages } from "@cohub/db";
import { extractTurnReferences } from "@cohub/core/references";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { enqueueReferences } from "./reference-index-queue.js";

/**
 * Collect assistant content across every message in a turn.
 *
 * A turn may span several assistant messages (intermediate tool_use rounds plus
 * the final answer). We aggregate them at the turn boundary so cross-resource
 * tool calls from intermediate steps are not lost, while keeping the reference
 * index at turn granularity — the surface users actually work with.
 */
const collectTurnAssistantContent = async (input: {
  sessionId: string;
  turnId: string;
}): Promise<ContentBlock[]> => {
  const rows = await db
    .select({ role: sessionMessages.role, content: sessionMessages.content })
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.sessionId, input.sessionId),
        sql`${sessionMessages.meta}->>'turnId' = ${input.turnId}`,
      ),
    )
    .orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));

  const blocks: ContentBlock[] = [];
  for (const row of rows) {
    if (row.role !== "assistant") continue;
    if (Array.isArray(row.content)) blocks.push(...(row.content as ContentBlock[]));
  }
  return blocks;
};

/**
 * Index the references carried by a finalized turn (participant, @mentions,
 * cross-resource tool calls) into resource_references.
 *
 * Tool calls are aggregated from all assistant messages in the turn so nothing
 * from intermediate steps is dropped. Fire-and-forget: this is a stats
 * side-effect and must never block or fail the turn lifecycle. The backfill
 * script rebuilds anything missed, so a dropped write is self-healing.
 */
export const indexTurnReferences = (input: {
  spaceId: string;
  turn: SessionTurnRecord;
}): void => {
  const { spaceId, turn } = input;
  void (async () => {
    const assistantContent = await collectTurnAssistantContent({
      sessionId: turn.sessionId,
      turnId: turn.id,
    });
    const references = extractTurnReferences({
      spaceId,
      sessionId: turn.sessionId,
      turnId: turn.id,
      userUuid: turn.userUuid,
      userContent: turn.userContent,
      userText: turn.userText,
      assistantContent: assistantContent.length > 0 ? assistantContent : turn.assistantContent,
    });
    if (references.length === 0) return;
    enqueueReferences(references);
  })().catch((error) =>
    logger.warn("[ReferenceIndex] failed to index turn references", {
      sessionId: turn.sessionId,
      turnId: turn.id,
      error,
    }),
  );
};
