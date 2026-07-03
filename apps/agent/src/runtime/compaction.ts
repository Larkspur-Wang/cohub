import {
  calculateContextTokens,
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  shouldCompact,
} from "@earendil-works/pi-agent-core/base";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { logger } from "../logger.js";
import type { SessionHandle } from "../session.js";
import { persistCompactionTurn } from "../persistence.js";
import { refreshSessionHandleFileSignature } from "../session.js";
import { getAgentTracer } from "@cohub/infra/tracing/agent";
import { db } from "../db.js";
import { sessionTurns } from "@cohub/db";
import { and, eq, sql } from "drizzle-orm";

export type CompactionOutcome =
  | { compacted: true; summary: string; tokensBefore: number; firstKeptEntryId: string; archivePath: string | undefined }
  | { compacted: false; reason: string };

const COMPACTION_SETTINGS = {
  ...DEFAULT_COMPACTION_SETTINGS,
  enabled: true,
};

/**
 * Check if the session needs auto-compaction and run it if so.
 * Called before a new turn starts (pre-turn), inside the session lock.
 *
 * Order of operations (failures are non-destructive):
 *   1. LLM summarization — if fails, nothing is touched
 *   2. Session file: append compaction entry, archive old file, rewrite trimmed
 *   3. Rebuild agent state from compacted context, measure tokensAfter
 *   4. DB persistence (compact turn + system message, re-sequence) with real tokensAfter + archivePath
 *
 * Note on promptMessages: pi's `Agent.prompt(messages)` calls `createContextSnapshot()`
 * which reads `agent.state.messages` at call time. Since step 3 replaces
 * `agent.state.messages` with the compacted context before the caller invokes
 * `promptMessages`, the new user messages are appended to the compacted context.
 */
export async function maybeAutoCompact(
  handle: SessionHandle,
  input: { actorUserId: string | null; abortSignal?: AbortSignal },
): Promise<CompactionOutcome> {
  const settings = COMPACTION_SETTINGS;
  if (!settings.enabled) return { compacted: false, reason: "disabled" };

  const model = handle.session.agent.state.model;
  const contextWindow = model.contextWindow ?? 0;
  if (!contextWindow) return { compacted: false, reason: "no_context_window" };

  // Find the last valid assistant message to get usage info.
  const messages = handle.session.agent.state.messages;
  let lastAssistant: AssistantMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.role === "assistant") {
      const am = msg as unknown as AssistantMessage;
      if (am.stopReason !== "aborted" && am.usage && calculateContextTokens(am.usage) > 0) {
        lastAssistant = am;
        break;
      }
    }
  }

  let contextTokens: number;
  if (lastAssistant?.usage) {
    contextTokens = calculateContextTokens(lastAssistant.usage);
  } else {
    const estimate = estimateContextTokens(messages);
    if (estimate.tokens === 0 || estimate.lastUsageIndex === null) {
      return { compacted: false, reason: "no_usage_data" };
    }
    contextTokens = estimate.tokens;
  }

  if (!shouldCompact(contextTokens, contextWindow, settings)) {
    return { compacted: false, reason: "below_threshold" };
  }

  logger.info(
    `[Compaction] auto-compact triggered sessionId=${handle.sessionId} contextWindow=${contextWindow} tokens=${contextTokens}`,
  );

  const tracer = getAgentTracer();
  const outcome = await tracer.startActiveSpan("agent.compaction", async (span): Promise<CompactionOutcome> => {
    span.setAttribute("cohub.session_id", handle.sessionId);
    span.setAttribute("agent.context_window", contextWindow);

    try {
      // ── 1. Prepare & summarize ──
      const branchEntries = handle.sessionManager.getBranchEntries() as Parameters<typeof prepareCompaction>[0];
      const preparationResult = prepareCompaction(branchEntries, settings);
      if (!preparationResult.ok) {
        span.setAttribute("agent.compaction.error", preparationResult.error.message);
        return { compacted: false, reason: `prepare_failed: ${preparationResult.error.message}` };
      }
      const preparation = preparationResult.value;
      if (!preparation) {
        return { compacted: false, reason: "nothing_to_compact" };
      }
      if (preparation.messagesToSummarize.length === 0) {
        // Nothing to summarize — the session is too small to benefit from compaction.
        return { compacted: false, reason: "nothing_to_summarize" };
      }

      span.setAttribute("agent.compaction.tokens_before", preparation.tokensBefore);
      span.setAttribute("agent.compaction.messages_to_summarize", preparation.messagesToSummarize.length);

      const apiKey = handle.session.modelRegistry.getApiKey(model.provider);
      if (!apiKey) return { compacted: false, reason: "no_api_key" };
      const headers = handle.session.modelRegistry.getHeaders(model.provider, model.id) ?? undefined;

      const compactResult = await compact(preparation, model, apiKey, headers, undefined, input.abortSignal);
      if (!compactResult.ok) {
        span.setAttribute("agent.compaction.error", compactResult.error.message);
        logger.warn(`[Compaction] summarization failed sessionId=${handle.sessionId}: ${compactResult.error.message}`);
        return { compacted: false, reason: `compact_failed: ${compactResult.error.message}` };
      }
      const result = compactResult.value;

      // ── Adjust cut point to turn boundary ──
      // Pi's findCutPoint may split a turn (firstKeptEntryId = mid-turn message).
      // We snap to the user message that starts the containing turn, so we always
      // keep complete turns. The split-turn prefix is already included in the
      // summary via pi's turnPrefixMessages mechanism.
      let firstKeptEntryId = result.firstKeptEntryId;
      const turnStartEntryId = handle.sessionManager.findTurnStartEntryId(firstKeptEntryId);
      if (turnStartEntryId && turnStartEntryId !== firstKeptEntryId) {
        logger.debug(`[Compaction] snapping cut from ${firstKeptEntryId} to turn start ${turnStartEntryId}`);
        firstKeptEntryId = turnStartEntryId;
      }

      // ── 2. Session file: append compaction entry, archive, rewrite ──
      const compactionEntryId = handle.sessionManager.appendCompaction(
        result.summary,
        firstKeptEntryId,
        result.tokensBefore,
        result.details,
      );

      const archivePath = await handle.sessionManager.archiveAndRewrite(
        compactionEntryId,
        firstKeptEntryId,
      );

      if (!archivePath) {
        // File archive/rewrite failed before rewriting. The compaction entry
        // was appended but is still at the end of entries. removeLastEntry
        // removes it from memory and rewrites the file.
        logger.error(`[Compaction] archiveAndRewrite failed sessionId=${handle.sessionId}, aborting compaction`);
        span.setAttribute("agent.compaction.error", "archive_rewrite_failed");
        handle.sessionManager.removeLastEntry();
        return { compacted: false, reason: "archive_rewrite_failed" };
      }

      // ── 3. Rebuild agent state + measure tokensAfter ──
      // Use raw estimateTokens per message instead of estimateContextTokens,
      // which would inherit the pre-compaction assistant usage (stale).
      const sessionContext = handle.sessionManager.buildSessionContext();
      handle.session.agent.state.messages = sessionContext.messages;
      await refreshSessionHandleFileSignature(handle);

      const tokensAfter = sessionContext.messages.reduce(
        (sum, msg) => sum + estimateTokens(msg),
        0,
      );

      span.setAttribute("agent.compaction.tokens_after", tokensAfter);
      span.setAttribute("agent.compaction.archive_path", archivePath);

      // ── 4. Resolve DB sequence for the first kept turn ──
      // Try the firstKeptEntryId first, then scan forward through kept entries
      // until we find one with a turnId.
      const firstKeptTurnId = handle.sessionManager.getFirstKeptTurnId(firstKeptEntryId);
      let insertBeforeSequence: number | null = null;
      if (firstKeptTurnId) {
        const [turnRow] = await db.select({ sequence: sessionTurns.sequence })
          .from(sessionTurns)
          .where(and(eq(sessionTurns.id, firstKeptTurnId), eq(sessionTurns.sessionId, handle.sessionId)))
          .limit(1);
        insertBeforeSequence = turnRow?.sequence ?? null;
      }
      if (insertBeforeSequence == null) {
        // Cannot resolve the first kept turn's sequence. Append at the end
        // rather than shifting all existing turns.
        logger.warn(`[Compaction] could not resolve firstKeptTurnId sequence; appending compact turn at end`);
        const [maxRow] = await db.select({ max: sql<number>`coalesce(max(${sessionTurns.sequence}), 0)::int` })
          .from(sessionTurns).where(eq(sessionTurns.sessionId, handle.sessionId));
        insertBeforeSequence = (maxRow?.max ?? 0) + 1;
      }

      // ── 5. DB persistence ──
      const dbResult = await persistCompactionTurn({
        spaceId: handle.spaceId,
        sessionId: handle.sessionId,
        actorUserId: input.actorUserId,
        summary: result.summary,
        tokensBefore: result.tokensBefore,
        tokensAfter,
        firstKeptEntryId,
        model: { provider: model.provider, id: model.id },
        contextWindow,
        keepRecentTokens: settings.keepRecentTokens,
        summarizedMessageCount: preparation.messagesToSummarize.length,
        archivePath,
        insertBeforeSequence,
      });

      if (!dbResult) {
        // DB failed. archiveAndRewrite already succeeded, so the compaction
        // entry is root (index 0), not last. Use restoreFromArchive to reload
        // the pre-compaction state from the archive copy.
        logger.error(
          `[Compaction] DB persistence failed; restoring session file from archive sessionId=${handle.sessionId}`,
        );
        span.setAttribute("agent.compaction.error", "db_persistence_failed");
        const restored = await handle.sessionManager.restoreFromArchive(archivePath).catch((restoreError) => {
          logger.error(`[Compaction] restoreFromArchive failed sessionId=${handle.sessionId}:`, restoreError);
          return false;
        });
        if (restored) {
          const restoredContext = handle.sessionManager.buildSessionContext();
          handle.session.agent.state.messages = restoredContext.messages;
          await refreshSessionHandleFileSignature(handle);
        }
        return { compacted: false, reason: "db_persistence_failed" };
      }

      logger.info(
        `[Compaction] done sessionId=${handle.sessionId} tokensBefore=${result.tokensBefore} tokensAfter=${tokensAfter} archive=${archivePath}`,
      );

      return {
        compacted: true,
        summary: result.summary,
        tokensBefore: result.tokensBefore,
        firstKeptEntryId,
        archivePath,
      };
    } catch (error) {
      span.recordException(error as Error);
      logger.error(`[Compaction] unexpected error sessionId=${handle.sessionId}:`, error);
      // If archiveAndRewrite threw after appending compaction entry but before
      // completing the rewrite, its internal rollback restored savedEntries
      // which still contains the compaction entry at the end. Clean it up.
      try {
        handle.sessionManager.removeLastEntry();
      } catch (cleanupError) {
        logger.error(`[Compaction] cleanup removeLastEntry failed sessionId=${handle.sessionId}:`, cleanupError);
      }
      return { compacted: false, reason: `error: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  return outcome;
}
