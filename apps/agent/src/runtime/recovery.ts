import { and, asc, eq, gt, sql } from "drizzle-orm";
import { sessionMessages, sessionTurns, spaceSessions } from "@cohub/db";
import { listRuntimeRecoverySpaces, listRuntimeRecoveryTurns, readRuntimeRecovery, runtimeRecoveryActive } from "@cohub/core/sessions";
import { resolveHarness } from "@cohub/protocol";
import { AGENT_RUNTIME_SWEEP_JOB_NAME, enqueueRuntimeRecovery, type AgentRuntimeRecoveryJobData, type AgentRuntimeSweepJobData } from "@cohub/infra/agent-queue";
import { db } from "../db.js";
import { acquireSessionLock } from "../session-lock.js";
import { deliverRuntimeMessage, persistAssistantMessage, persistUserMessage, publishSessionTurnsUpdated } from "../persistence.js";
import { agentTurnQueue, enqueueAgentTurnJob } from "../queue.js";
import type { ClaimedTurnBatch } from "../batch.js";
import { logger } from "../logger.js";
import { RuntimeResultUnavailableError } from "./exchange.js";
import { executeRemoteHarnessTurn, markRuntimeRecovery } from "./remote-runtime.js";

export async function sweepRuntimeRecovery(input: AgentRuntimeSweepJobData = { runtimeSweep: true }) {
  // Wake orphaned executions before attempting potentially slow external deliveries.
  const spaces = input.deliveryCursor ? [] : await listRuntimeRecoverySpaces(db);
  for (const { spaceId } of spaces) await enqueueRuntimeRecovery(agentTurnQueue, { spaceId });
  const pending = await db.select({ message: sessionMessages, spaceId: spaceSessions.spaceId }).from(sessionMessages)
    .innerJoin(spaceSessions, eq(spaceSessions.id, sessionMessages.sessionId))
    .where(and(sql`${sessionMessages.meta}->>'runtimeDeliveryPending' = 'true'`, input.deliveryCursor ? gt(sessionMessages.id, input.deliveryCursor) : undefined))
    .orderBy(asc(sessionMessages.id)).limit(50);
  const started = Date.now();
  let processed = 0;
  for (const row of pending) {
    await deliverRuntimeMessage(row.spaceId, row.message).catch((error) => logger.warn("[Runtime] delivery remains pending", error));
    processed++;
    if (Date.now() - started >= 15_000) break;
  }
  const cursor = pending[processed - 1]?.message.id;
  if (cursor && (processed < pending.length || pending.length === 50)) {
    await agentTurnQueue.add(AGENT_RUNTIME_SWEEP_JOB_NAME, { runtimeSweep: true, deliveryCursor: cursor }, {
      jobId: `runtime-delivery-page-${cursor}`, delay: 1000, removeOnComplete: true, removeOnFail: true,
    });
  }
  return { spaces: spaces.length };
}

/** Runtime-scoped coordination; only orphaned executions are touched under their existing lock. */
export async function recoverRuntime(input: AgentRuntimeRecoveryJobData) {
  const turns = await listRuntimeRecoveryTurns(db, input.spaceId);
  let recovered = 0, attention = 0, lockedRecovery = 0;
  for (const candidate of turns) {
    const lock = await acquireSessionLock(candidate.sessionId);
    if (!lock) {
      if (input.confirmation?.turnIds.includes(candidate.id)) lockedRecovery++;
      continue;
    }
    let drain = false;
    try {
      const [turn] = await db.select().from(sessionTurns).where(and(eq(sessionTurns.id, candidate.id), runtimeRecoveryActive)).limit(1);
      if (!turn) continue;
      const harness = resolveHarness(turn.meta);
      if (harness === "cohub") continue;
      const recovery = readRuntimeRecovery(turn.meta);
      const confirmation = input.confirmation?.turnIds.includes(turn.id) && recovery?.state === "attention" ? input.confirmation : null;
      if (confirmation || recovery?.state === "confirmed_stopped") {
        lock.signal.throwIfAborted();
        const resolution = recovery?.state === "confirmed_stopped" ? recovery : { ...recovery, state: "confirmed_stopped" as const, resolvedBy: confirmation?.actorUserId, resolvedAt: new Date().toISOString() };
        const [confirmed] = await db.update(sessionTurns).set({ meta: sql`coalesce(${sessionTurns.meta}, '{}'::jsonb) || ${JSON.stringify({ runtimeRecovery: resolution })}::jsonb` })
          .where(and(eq(sessionTurns.id, turn.id), runtimeRecoveryActive)).returning({ id: sessionTurns.id });
        if (!confirmed) continue;
        const meta = turn.meta as Record<string, unknown> | null;
        const userMessageId = String(meta?.userMessageId ?? meta?.messageId ?? turn.id);
        const [userMessage] = await db.select({ id: sessionMessages.id }).from(sessionMessages).where(eq(sessionMessages.id, userMessageId)).limit(1);
        if (!userMessage) await persistUserMessage({ spaceId: input.spaceId, sessionId: turn.sessionId, turnId: turn.id, userMessageId, content: turn.userContent, meta: meta ?? {} });
        lock.signal.throwIfAborted();
        await persistAssistantMessage({ spaceId: input.spaceId, spaceSessionId: turn.sessionId, turnId: turn.id, userMessageId: String(meta?.userMessageId ?? meta?.messageId ?? turn.id), userId: turn.userUuid,
          idempotencyKey: `runtime-resolution:${turn.id}`, messageOrdinal: 100_000,
          event: { message: { role: "assistant", content: [{ type: "system_note", note_type: "info", text: "Runtime stopped by confirmation; prior effects remain unknown. Do not replay. / 已确认 Runtime 停止，此前执行影响仍未知，请勿重跑。" }], stopReason: "aborted", meta: { runtime: "local", harness, runtimeResolution: true, messageKind: "assistant_final" } } },
        });
        drain = true; recovered++;
        continue;
      }
      const owner = { ...turn, intent: turn.intent ?? "followup" };
      const meta = turn.meta as Record<string, unknown> | null;
      const batch: ClaimedTurnBatch = { ownerTurn: owner, turns: [owner], mergedTurns: [], executionBatch: { ownerTurnId: turn.id, turnIds: [turn.id], mergedTurnIds: [], userMessageIds: [String(meta?.userMessageId ?? meta?.messageId ?? turn.id)], anchorUserMessageId: String(meta?.userMessageId ?? meta?.messageId ?? turn.id) } };
      try {
        await executeRemoteHarnessTurn({ spaceId: input.spaceId, sessionId: turn.sessionId, batch, actorUserId: turn.userUuid, harness, accessMode: "read_only", recovery: true, abortSignal: lock.signal, leaseSignal: lock.signal });
        recovered++; drain = true;
      } catch (error) {
        if (error instanceof RuntimeResultUnavailableError) {
          attention++;
          if (!lock.signal.aborted && recovery?.state !== "attention") {
            await markRuntimeRecovery(turn.id, { state: "attention", ownerUserId: recovery?.ownerUserId });
            await publishSessionTurnsUpdated({ sessionId: turn.sessionId, turnIds: [turn.id] });
          }
        }
        logger.debug("[Runtime] automatic reconciliation will retry", { spaceId: input.spaceId, turnId: turn.id, error });
      }
    } finally {
      await lock.release();
      if (drain) await enqueueAgentTurnJob({ spaceId: input.spaceId, sessionId: candidate.sessionId, reason: "drain" });
    }
  }
  if (lockedRecovery) throw new Error("Runtime recovery is waiting for active execution locks");
  return { recovered, attention };
}
