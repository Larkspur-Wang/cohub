import { sql } from "drizzle-orm";
import type { ContentBlock } from "@cohub/protocol/core";
import { db } from "./db.js";
import { env } from "./env.js";
import type { AgentTurnJobData } from "./queue.js";

type TurnRow = {
  id: string;
  sessionId: string;
  userUuid: string | null;
  sequence: number;
  status: string;
  userContent: ContentBlock[];
  userText: string | null;
  meta: unknown;
  updatedAt: Date | null;
};

type ExecutionBatchMeta = {
  ownerTurnId: string;
  turnIds: string[];
  mergedTurnIds: string[];
  userMessageIds: string[];
  anchorUserMessageId: string | null;
};

export type ClaimedTurnBatch = {
  ownerTurn: TurnRow;
  turns: TurnRow[];
  mergedTurns: TurnRow[];
  executionBatch: ExecutionBatchMeta;
};

export type ClaimResult =
  | { kind: "claimed"; batch: ClaimedTurnBatch }
  | { kind: "busy"; activeTurnId: string; activeUpdatedAt: Date | null; activeStatus: string }
  | { kind: "noop" };

const TERMINAL = new Set(["completed", "failed", "interrupted", "merged", "cancelled"]);
const ACTIVE = new Set(["running", "abort_requested"]);
const STALE_ACTIVE_TURN_MS = env.AGENT_STALE_ACTIVE_TURN_MS;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normalizeTurn(row: Record<string, unknown>): TurnRow {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    userUuid: typeof row.user_uuid === "string" ? row.user_uuid : null,
    sequence: Number(row.sequence),
    status: String(row.status),
    userContent: row.user_content as ContentBlock[],
    userText: typeof row.user_text === "string" ? row.user_text : null,
    meta: row.meta ?? null,
    updatedAt: asDate(row.updated_at),
  };
}

const getMetaString = (turn: TurnRow, key: string): string | null => {
  const value = asRecord(turn.meta)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

function getUserMessageId(turn: TurnRow): string {
  return getMetaString(turn, "userMessageId") ?? getMetaString(turn, "messageId") ?? turn.id;
}

function getExecutionBatch(turn: TurnRow): ExecutionBatchMeta | null {
  const batch = asRecord(turn.meta).executionBatch;
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return null;
  const record = batch as Record<string, unknown>;
  if (typeof record.ownerTurnId !== "string") return null;
  if (!Array.isArray(record.turnIds)) return null;
  return {
    ownerTurnId: record.ownerTurnId,
    turnIds: record.turnIds.filter((item): item is string => typeof item === "string"),
    mergedTurnIds: Array.isArray(record.mergedTurnIds) ? record.mergedTurnIds.filter((item): item is string => typeof item === "string") : [],
    userMessageIds: Array.isArray(record.userMessageIds) ? record.userMessageIds.filter((item): item is string => typeof item === "string") : [],
    anchorUserMessageId: typeof record.anchorUserMessageId === "string" ? record.anchorUserMessageId : null,
  };
}

function toPgUuidArrayParam(ids: string[]) {
  return `{${ids.join(",")}}`;
}

function isActiveStatus(status: string) {
  return ACTIVE.has(status);
}

function isStaleActiveTurn(turn: TurnRow) {
  const updatedAt = turn.updatedAt?.getTime();
  return updatedAt != null && Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_ACTIVE_TURN_MS;
}

async function markStaleTurnInterrupted(tx: Transaction, turn: TurnRow) {
  await tx.execute(sql`
    update v2.session_turns
    set status = 'interrupted',
        stop_reason = 'stale_active_recovered',
        summary = ${JSON.stringify({ finishReason: "interrupted", reason: "stale_active_recovered" })}::jsonb,
        meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ staleActiveRecoveredAt: new Date().toISOString(), previousStatus: turn.status })}::jsonb,
        completed_at = now(),
        updated_at = now()
    where id = ${turn.id} and status in ('running', 'abort_requested')
  `);
}

async function selectTurnsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.execute(sql`
    select id, session_id, user_uuid, sequence, status, user_content, user_text, meta, updated_at
    from v2.session_turns
    where id = any(${toPgUuidArrayParam(ids)}::uuid[])
    order by sequence asc
  `);
  return rows.map((row) => normalizeTurn(row as Record<string, unknown>));
}

export async function claimTurnBatch(job: AgentTurnJobData): Promise<ClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from v2.space_sessions where id = ${job.sessionId} for update`);

    const requestedRows = await tx.execute(sql`
      select id, session_id, user_uuid, sequence, status, user_content, user_text, meta, updated_at
      from v2.session_turns
      where id = any(${toPgUuidArrayParam(job.turnIds)}::uuid[])
      order by sequence asc
    `);
    const requested = requestedRows.map((row) => normalizeTurn(row as Record<string, unknown>));
    if (requested.length === 0) return { kind: "noop" as const };

    const requestedNonTerminal = requested.filter((turn) => !TERMINAL.has(turn.status));
    const requestedMaxSequence = requested.reduce((max, turn) => Math.max(max, turn.sequence), 0);
    if (requestedNonTerminal.length === 0) {
      const ownerId = requested
        .map((turn) => asRecord(turn.meta).mergedIntoTurnId)
        .find((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (ownerId) {
        const ownerRows = await tx.execute(sql`
          select id, session_id, user_uuid, sequence, status, user_content, user_text, meta, updated_at
          from v2.session_turns
          where id = ${ownerId}
          limit 1
        `);
        const owner = ownerRows[0] ? normalizeTurn(ownerRows[0] as Record<string, unknown>) : null;
        if (owner && isActiveStatus(owner.status)) {
          if (isStaleActiveTurn(owner)) {
            await markStaleTurnInterrupted(tx, owner);
            return { kind: "noop" as const };
          }
          const batch = getExecutionBatch(owner);
          if (batch?.turnIds.some((turnId) => job.turnIds.includes(turnId))) {
            const rows = await selectTurnsByIds(batch.turnIds);
            return {
              kind: "claimed" as const,
              batch: {
                ownerTurn: owner,
                turns: rows,
                mergedTurns: rows.filter((turn) => turn.id !== owner.id),
                executionBatch: batch,
              },
            };
          }
        }
      }
      return { kind: "noop" as const };
    }

    const activeRows = await tx.execute(sql`
      select id, session_id, user_uuid, sequence, status, user_content, user_text, meta, updated_at
      from v2.session_turns
      where session_id = ${job.sessionId} and status in ('running', 'abort_requested')
      order by sequence asc
      limit 1
    `);
    const active = activeRows[0] ? normalizeTurn(activeRows[0] as Record<string, unknown>) : null;
    if (active) {
      if (isStaleActiveTurn(active)) {
        await markStaleTurnInterrupted(tx, active);
      } else {
        const batch = getExecutionBatch(active);
        if (batch?.turnIds.some((turnId) => job.turnIds.includes(turnId))) {
          const rows = await selectTurnsByIds(batch.turnIds);
          return {
            kind: "claimed" as const,
            batch: {
              ownerTurn: active,
              turns: rows,
              mergedTurns: rows.filter((turn) => turn.id !== active.id),
              executionBatch: batch,
            },
          };
        }
        return { kind: "busy" as const, activeTurnId: active.id, activeUpdatedAt: active.updatedAt, activeStatus: active.status };
      }
    }

    const queuedRows = await tx.execute(sql`
      select id, session_id, user_uuid, sequence, status, user_content, user_text, meta, updated_at
      from v2.session_turns
      where session_id = ${job.sessionId} and status = 'queued' and sequence <= ${requestedMaxSequence}
      order by sequence asc
    `);
    const queued = queuedRows.map((row) => normalizeTurn(row as Record<string, unknown>));
    if (queued.length === 0) return { kind: "noop" as const };

    const owner = queued[queued.length - 1];
    if (!owner) return { kind: "noop" as const };
    const merged = queued.slice(0, -1);
    const userMessageIds = queued.map(getUserMessageId).filter((value): value is string => Boolean(value));
    const executionBatch: ExecutionBatchMeta = {
      ownerTurnId: owner.id,
      turnIds: queued.map((turn) => turn.id),
      mergedTurnIds: merged.map((turn) => turn.id),
      userMessageIds,
      anchorUserMessageId: userMessageIds.at(-1) ?? null,
    };

    for (const turn of merged) {
      await tx.execute(sql`
        update v2.session_turns
        set status = 'merged',
            stop_reason = 'merged',
            summary = ${JSON.stringify({ finishReason: "merged", reason: "merge", mergedIntoTurnId: owner.id })}::jsonb,
            meta = coalesce(meta, '{}'::jsonb) || ${JSON.stringify({ mergedIntoTurnId: owner.id, mergedAt: new Date().toISOString() })}::jsonb,
            completed_at = now(),
            updated_at = now()
        where id = ${turn.id}
      `);
    }

    const ownerMeta = { ...asRecord(owner.meta), executionBatch };
    await tx.execute(sql`
      update v2.session_turns
      set status = 'running',
          started_at = coalesce(started_at, now()),
          updated_at = now(),
          meta = ${JSON.stringify(ownerMeta)}::jsonb
      where id = ${owner.id}
    `);

    const updatedOwner = { ...owner, status: "running", meta: ownerMeta, updatedAt: new Date() };
    return {
      kind: "claimed" as const,
      batch: {
        ownerTurn: updatedOwner,
        turns: [...merged, updatedOwner],
        mergedTurns: merged,
        executionBatch,
      },
    };
  });
}

export async function enqueueNextQueuedTurn(input: { spaceId: string; sessionId: string; enqueue: (data: AgentTurnJobData) => Promise<unknown> }) {
  const rows = await db.execute(sql`
    select id
    from v2.session_turns
    where session_id = ${input.sessionId} and status = 'queued'
    order by sequence asc
    limit 1
  `);
  const rawId = rows[0] ? (rows[0] as Record<string, unknown>).id : null;
  const id = typeof rawId === "string" ? rawId : null;
  if (!id) return null;
  await input.enqueue({ spaceId: input.spaceId, sessionId: input.sessionId, turnIds: [id] });
  return id;
}

export function buildUserMessagesForBatch(batch: ClaimedTurnBatch) {
  return batch.turns.map((turn) => {
    const meta = asRecord(turn.meta);
    const userMessageId = getUserMessageId(turn);
    return {
      turnId: turn.id,
      turnSeq: turn.sequence,
      userMessageId,
      content: turn.userContent,
      meta: {
        ...meta,
        userMessageId,
        messageId: typeof meta.messageId === "string" && meta.messageId.trim() ? meta.messageId : userMessageId,
        turnId: typeof meta.turnId === "string" && meta.turnId.trim() ? meta.turnId : turn.id,
      },
    };
  });
}
