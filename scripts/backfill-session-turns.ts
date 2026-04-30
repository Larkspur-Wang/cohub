import "dotenv/config";
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "apps/api/.env", override: false });

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, not, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ContentBlock, Usage } from "@neta-art/cohub-protocol/core";
import type { SessionTurnStatus, SessionTurnSummary } from "@neta-art/cohub-protocol/model";
import * as schema from "../apps/api/src/db/schema-v2.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/cohub";
const dbClient = postgres(connectionString, { prepare: false });
const db = drizzle(dbClient, { schema });
const { sessionMessages, sessionTurns, spaceSessions } = schema;

const MIGRATION_NAME = "session-turns-backfill";
const MIGRATION_VERSION = 1;
const TURN_SEQUENCE_OFFSET = 1_000_000_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

type Args = {
  write: boolean;
  dryRun: boolean;
  cutoff: Date | null;
  spaceId: string | null;
  sessionId: string | null;
  limit: number;
  skipObjects: boolean;
};

type MessageRow = typeof schema.sessionMessages.$inferSelect;
type TurnRow = typeof schema.sessionTurns.$inferSelect;
type SessionRow = typeof schema.spaceSessions.$inferSelect;

type ExistingTurnMeta = {
  id: string;
  sequence: number;
  sourceUserMessageId: string | null;
};

type Segment = {
  user: MessageRow;
  messages: MessageRow[];
  assistantMessages: MessageRow[];
  kindByMessageId: Map<string, string>;
  closedByNextUserMessageId: string | null;
};

type PlannedTurn = {
  id: string;
  sequence: number;
  segment: Segment;
  status: SessionTurnStatus;
  assistant: MessageRow | null;
  finalAssistant: MessageRow | null;
  usage: Usage | null;
  anomalyReasons: string[];
};

type SessionPlan = {
  session: SessionRow;
  existingTurns: TurnRow[];
  existingBySourceUserMessageId: Map<string, ExistingTurnMeta>;
  segments: Segment[];
  missing: PlannedTurn[];
  messageIdsToPatchByTurnId: Map<string, string[]>;
  anomalies: string[];
};

type Stats = {
  sessionsScanned: number;
  sessionsNeedingBackfill: number;
  turnsToInsert: number;
  existingTurnsToShift: number;
  messagesToPatch: number;
  objectsToBuild: number;
  objectsBuilt: number;
  skippedNoMessages: number;
  anomalies: Record<string, number>;
  failures: number;
};

const parseArgs = (rawArgv: string[]): Args => {
  const argv = rawArgv.filter((arg) => arg !== "--");
  const readValue = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const has = (name: string) => argv.includes(name);
  const cutoffValue = readValue("--cutoff");
  const limitValue = readValue("--limit");
  const write = has("--write");
  const dryRun = has("--dry-run") || !write;
  const cutoff = cutoffValue ? new Date(cutoffValue) : null;
  if (cutoffValue && Number.isNaN(cutoff?.getTime())) throw new Error(`Invalid --cutoff: ${cutoffValue}`);
  const limit = Math.min(Math.max(Number(limitValue ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  return {
    write,
    dryRun,
    cutoff,
    spaceId: readValue("--space-id") ?? null,
    sessionId: readValue("--session-id") ?? null,
    limit,
    skipObjects: has("--skip-objects"),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getMeta = (row: { meta: unknown }) => isRecord(row.meta) ? row.meta : {};
const getTurnId = (row: MessageRow) => {
  const value = getMeta(row).turnId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const getSegmentTurnIds = (segment: Segment) => [...new Set(segment.messages.map(getTurnId).filter((turnId): turnId is string => Boolean(turnId)))];

const addAnomaly = (stats: Stats, key: string) => {
  stats.anomalies[key] = (stats.anomalies[key] ?? 0) + 1;
};

const deterministicTurnId = (sessionId: string, userMessageId: string) => {
  const hex = createHash("sha256")
    .update(`${MIGRATION_NAME}:v${MIGRATION_VERSION}:${sessionId}:${userMessageId}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

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

const hasToolUse = (content: ContentBlock[]) => content.some((block) => block.type === "tool_use");

const derivePreviewText = (content: ContentBlock[]) => content
  .flatMap((block) => {
    switch (block.type) {
      case "text":
        return [block.text];
      case "image":
        return block.source.type === "url" ? [block.source.url] : [];
      case "system_note":
        return [block.text];
      default:
        return [];
    }
  })
  .join("\n")
  .trim();

const hasAssistantError = (message: MessageRow) => Boolean(message.errorMessage) || message.stopReason === "error" || message.stopReason === "aborted";

const inferAssistantKinds = (assistantMessages: MessageRow[]) => {
  const kinds = new Map<string, string>();
  const explicitFinalOrError = assistantMessages.some((message) => {
    const kind = getMeta(message).messageKind;
    return kind === "assistant_final" || kind === "assistant_error";
  });
  const lastAssistantId = assistantMessages.at(-1)?.id ?? null;
  for (const message of assistantMessages) {
    const explicit = getMeta(message).messageKind;
    if (typeof explicit === "string" && explicit) {
      kinds.set(message.id, explicit);
      continue;
    }
    if (hasAssistantError(message)) {
      kinds.set(message.id, "assistant_error");
    } else if (!explicitFinalOrError && message.id === lastAssistantId && !hasToolUse(message.content as ContentBlock[]) && message.stopReason !== "tool_use") {
      kinds.set(message.id, "assistant_final");
    } else if (hasToolUse(message.content as ContentBlock[]) || message.stopReason === "tool_use") {
      kinds.set(message.id, "assistant_intermediate");
    } else {
      kinds.set(message.id, "assistant_intermediate");
    }
  }
  return kinds;
};

const buildSegments = (messages: MessageRow[]) => {
  const segments: Segment[] = [];
  const anomalies: string[] = [];
  let current: Segment | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      if (current) {
        current.kindByMessageId = inferAssistantKinds(current.assistantMessages);
        current.closedByNextUserMessageId = message.id;
        if (current.assistantMessages.length === 0) anomalies.push("turn_without_assistant_interrupted_by_next_user");
        segments.push(current);
      }
      current = { user: message, messages: [message], assistantMessages: [], kindByMessageId: new Map(), closedByNextUserMessageId: null };
      continue;
    }
    if (!current) {
      anomalies.push("orphan_assistant_before_first_user");
      continue;
    }
    current.messages.push(message);
    if (message.role === "assistant") current.assistantMessages.push(message);
  }
  if (current) {
    current.kindByMessageId = inferAssistantKinds(current.assistantMessages);
    if (current.assistantMessages.length === 0) anomalies.push("turn_without_assistant_at_tail");
    segments.push(current);
  }
  return { segments, anomalies };
};

const resolveUserUuid = (session: SessionRow, user: MessageRow) => {
  const meta = getMeta(user);
  for (const key of ["actorUserId", "authorUuid", "userUuid"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const sessionMeta = getMeta(session);
  const sessionUserUuid = sessionMeta.userUuid;
  return typeof sessionUserUuid === "string" && sessionUserUuid.trim() ? sessionUserUuid.trim() : null;
};

const planSegment = (segment: Segment, sequence: number): PlannedTurn => {
  const errors = segment.assistantMessages.filter((message) => segment.kindByMessageId.get(message.id) === "assistant_error" || hasAssistantError(message));
  const finals = segment.assistantMessages.filter((message) => segment.kindByMessageId.get(message.id) === "assistant_final");
  const finalAssistant = errors.at(-1) ?? finals.at(-1) ?? null;
  const assistant = finalAssistant ?? segment.assistantMessages.at(-1) ?? null;
  const anomalyReasons: string[] = [];
  let status: SessionTurnStatus = "completed";
  if (errors.length > 0) {
    status = "failed";
  } else if (finals.length > 0) {
    status = "completed";
  } else if (segment.closedByNextUserMessageId) {
    status = "interrupted";
    anomalyReasons.push(segment.assistantMessages.length > 0
      ? "assistant_final_inferred_from_last_intermediate_before_interrupt"
      : "turn_without_assistant_interrupted_by_next_user");
  } else if (segment.assistantMessages.length > 0) {
    status = "completed";
    anomalyReasons.push("assistant_final_inferred_from_last_intermediate");
  } else {
    status = "completed";
    anomalyReasons.push("turn_without_assistant_message");
  }
  const usage = segment.assistantMessages.reduce<Usage | null>((sum, message) => addUsage(sum, message.usage as Usage | null), null);
  return {
    id: deterministicTurnId(segment.user.sessionId, segment.user.id),
    sequence,
    segment,
    status,
    assistant,
    finalAssistant,
    usage,
    anomalyReasons,
  };
};

const sourceUserMessageIdFromTurn = (turn: TurnRow) => {
  const meta = getMeta(turn);
  const migration = isRecord(meta.migration) ? meta.migration : null;
  const value = migration?.sourceUserMessageId;
  return typeof value === "string" ? value : null;
};

const buildSessionPlan = async (session: SessionRow, cutoff: Date | null): Promise<SessionPlan> => {
  const messageFilters = [eq(sessionMessages.sessionId, session.id)];
  if (cutoff) messageFilters.push(lt(sessionMessages.createdAt, cutoff));
  const messages = await db.select().from(sessionMessages).where(and(...messageFilters)).orderBy(asc(sessionMessages.sequence), asc(sessionMessages.createdAt));
  const existingTurns = await db.select().from(sessionTurns).where(eq(sessionTurns.sessionId, session.id)).orderBy(asc(sessionTurns.sequence));
  const existingBySourceUserMessageId = new Map<string, ExistingTurnMeta>();
  for (const turn of existingTurns) {
    const sourceUserMessageId = sourceUserMessageIdFromTurn(turn);
    if (sourceUserMessageId) existingBySourceUserMessageId.set(sourceUserMessageId, { id: turn.id, sequence: turn.sequence, sourceUserMessageId });
  }

  const { segments, anomalies } = buildSegments(messages);
  const missingSegments: Segment[] = [];
  for (const segment of segments) {
    const segmentTurnIds = getSegmentTurnIds(segment);
    const alreadyMigrated = existingBySourceUserMessageId.has(segment.user.id);
    const existingMessageTurnIds = new Set(existingTurns.map((turn) => turn.id));
    const existingTurnIdsInSegment = segmentTurnIds.filter((turnId) => existingMessageTurnIds.has(turnId));
    if (segmentTurnIds.length > 1) anomalies.push("segment_has_multiple_message_turn_ids");
    if (segmentTurnIds.length > 0 && existingTurnIdsInSegment.length === 0) {
      anomalies.push("segment_has_message_turn_id_without_turn_record");
      continue;
    }
    if (!alreadyMigrated && existingTurnIdsInSegment.length === 0) missingSegments.push(segment);
  }
  const missing = missingSegments.map((segment, index) => planSegment(segment, index + 1));

  const messageIdsToPatchByTurnId = new Map<string, string[]>();
  for (const planned of missing) {
    const ids = planned.segment.messages.filter((message) => !getTurnId(message)).map((message) => message.id);
    if (ids.length > 0) messageIdsToPatchByTurnId.set(planned.id, ids);
  }

  return { session, existingTurns, existingBySourceUserMessageId, segments, missing, messageIdsToPatchByTurnId, anomalies };
};

const buildTurnInsertValues = (session: SessionRow, planned: PlannedTurn, cutoff: Date | null) => {
  const userText = (planned.segment.user.text ?? derivePreviewText(planned.segment.user.content as ContentBlock[])) || null;
  const assistantText = planned.assistant?.text ?? null;
  const completedAt = planned.assistant?.createdAt ?? planned.segment.messages.at(-1)?.createdAt ?? planned.segment.user.createdAt ?? new Date();
  const finishReason: NonNullable<SessionTurnSummary["finishReason"]> = planned.status === "failed" ? "failed" : planned.status === "interrupted" ? "interrupted" : "completed";
  return {
    id: planned.id,
    sessionId: session.id,
    userUuid: resolveUserUuid(session, planned.segment.user),
    sequence: planned.sequence,
    status: planned.status,
    intent: (typeof getMeta(planned.segment.user).intent === "string" ? getMeta(planned.segment.user).intent : "steer") as "steer" | "followup",
    userContent: planned.segment.user.content as ContentBlock[],
    userText,
    assistantContent: planned.assistant?.content as ContentBlock[] | undefined ?? null,
    assistantText,
    provider: planned.assistant?.provider ?? null,
    model: planned.assistant?.model ?? null,
    stopReason: planned.status === "interrupted" ? "interrupted" : planned.assistant?.stopReason ?? null,
    errorMessage: planned.status === "failed"
      ? planned.assistant?.errorMessage ?? "Assistant response failed during historical session turn migration"
      : planned.assistant?.errorMessage ?? null,
    usage: planned.usage,
    summary: {
      text: assistantText,
      finishReason,
    } satisfies SessionTurnSummary,
    intermediateIndex: null,
    intermediateSummary: null,
    meta: {
      migration: {
        name: MIGRATION_NAME,
        version: MIGRATION_VERSION,
        cutoff: cutoff?.toISOString() ?? null,
        sourceUserMessageId: planned.segment.user.id,
        sourceMessageIds: planned.segment.messages.map((message) => message.id),
        inferred: true,
        anomalyReasons: planned.anomalyReasons,
        interruptedByNextUserMessageId: planned.segment.closedByNextUserMessageId,
        objectBackfillStatus: "pending",
      },
    },
    startedAt: planned.segment.user.createdAt ?? new Date(),
    completedAt,
    createdAt: planned.segment.user.createdAt ?? new Date(),
    updatedAt: completedAt,
  };
};

const applySessionPlan = async (session: SessionRow, cutoff: Date | null) => {
  const applied = await db.transaction(async (tx) => {
    const [locked] = await tx.execute(sql`select id from v2.space_sessions where id = ${session.id} for update`);
    if (!locked) throw new Error(`Session not found while locking: ${session.id}`);

    const refreshedPlan = await buildSessionPlan(session, cutoff);
    if (refreshedPlan.missing.length === 0) return { plan: refreshedPlan, insertedCount: 0 };

    const insertValues = refreshedPlan.missing.map((planned) => buildTurnInsertValues(refreshedPlan.session, planned, cutoff));
    if (refreshedPlan.existingTurns.length > 0) {
      await tx.update(sessionTurns).set({
        sequence: sql`${sessionTurns.sequence} + ${TURN_SEQUENCE_OFFSET}`,
      }).where(eq(sessionTurns.sessionId, session.id));
    }

    let inserted: Array<{ id: string }> = [];
    try {
      inserted = await tx.insert(sessionTurns).values(insertValues).returning({ id: sessionTurns.id });
      if (inserted.length !== insertValues.length) {
        throw new Error(`Inserted ${inserted.length}/${insertValues.length} session turns for session ${session.id}`);
      }

      if (refreshedPlan.existingTurns.length > 0) {
        const insertedIds = inserted.map((row) => row.id);
        await tx.update(sessionTurns).set({
          sequence: sql`${sessionTurns.sequence} - ${TURN_SEQUENCE_OFFSET} + ${refreshedPlan.missing.length}`,
        }).where(and(
          eq(sessionTurns.sessionId, session.id),
          not(inArray(sessionTurns.id, insertedIds)),
        ));
      }
    } catch (error) {
      if (refreshedPlan.existingTurns.length > 0) {
        await tx.update(sessionTurns).set({
          sequence: sql`${sessionTurns.sequence} - ${TURN_SEQUENCE_OFFSET}`,
        }).where(and(
          eq(sessionTurns.sessionId, session.id),
          sql`${sessionTurns.sequence} > ${TURN_SEQUENCE_OFFSET}`,
        )).catch((rollbackError) => {
          console.error(`[${MIGRATION_NAME}] failed to restore shifted sequences for session ${session.id}`, rollbackError);
        });
      }
      throw error;
    }

    for (const [turnId, messageIds] of refreshedPlan.messageIdsToPatchByTurnId) {
      if (messageIds.length === 0) continue;
      await tx.update(sessionMessages).set({
        meta: sql`coalesce(${sessionMessages.meta}, '{}'::jsonb) || jsonb_build_object(
          'turnId', ${turnId},
          'sessionTurnsBackfill', jsonb_build_object(
            'name', ${MIGRATION_NAME},
            'version', ${MIGRATION_VERSION},
            'turnId', ${turnId},
            'backfilledAt', now()
          )
        )`,
      }).where(and(
        eq(sessionMessages.sessionId, session.id),
        inArray(sessionMessages.id, messageIds),
        isNull(sql`${sessionMessages.meta}->>'turnId'`),
      ));
    }
    return { plan: refreshedPlan, insertedCount: inserted.length };
  });
  return applied;
};

const backfillObjects = async (plan: SessionPlan) => {
  const { buildIntermediateObjectsForTurn } = await import("../apps/api/src/session-turns.js");
  for (const planned of plan.missing) {
    const intermediate = await buildIntermediateObjectsForTurn({
      spaceId: plan.session.spaceId,
      sessionId: plan.session.id,
      turnId: planned.id,
    });
    await db.update(sessionTurns).set({
      usage: addUsage(intermediate.summary.usage, planned.finalAssistant?.usage as Usage | null),
      intermediateIndex: intermediate.index,
      intermediateSummary: intermediate.summary,
      meta: sql`jsonb_set(coalesce(${sessionTurns.meta}, '{}'::jsonb), '{migration,objectBackfillStatus}', '"completed"'::jsonb, true)`,
      updatedAt: new Date(),
    }).where(eq(sessionTurns.id, planned.id));
  }
};

const listCandidateSessions = async (args: Args) => {
  const filters = [];
  if (args.sessionId) filters.push(eq(spaceSessions.id, args.sessionId));
  if (args.spaceId) filters.push(eq(spaceSessions.spaceId, args.spaceId));
  return db.select().from(spaceSessions).where(filters.length > 0 ? and(...filters) : undefined).orderBy(asc(spaceSessions.createdAt), asc(spaceSessions.id)).limit(args.limit);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const stats: Stats = {
    sessionsScanned: 0,
    sessionsNeedingBackfill: 0,
    turnsToInsert: 0,
    existingTurnsToShift: 0,
    messagesToPatch: 0,
    objectsToBuild: 0,
    objectsBuilt: 0,
    skippedNoMessages: 0,
    anomalies: {},
    failures: 0,
  };

  console.log(`[${MIGRATION_NAME}] starting`, {
    mode: args.dryRun ? "dry-run" : "write",
    cutoff: args.cutoff?.toISOString() ?? null,
    spaceId: args.spaceId,
    sessionId: args.sessionId,
    limit: args.limit,
    skipObjects: args.skipObjects,
  });

  const sessions = await listCandidateSessions(args);
  for (const session of sessions) {
    stats.sessionsScanned += 1;
    try {
      const plan = await buildSessionPlan(session, args.cutoff);
      if (plan.segments.length === 0) {
        stats.skippedNoMessages += 1;
        continue;
      }
      for (const anomaly of plan.anomalies) addAnomaly(stats, anomaly);
      for (const planned of plan.missing) for (const anomaly of planned.anomalyReasons) addAnomaly(stats, anomaly);
      if (plan.missing.length === 0) continue;

      stats.sessionsNeedingBackfill += 1;
      stats.turnsToInsert += plan.missing.length;
      stats.existingTurnsToShift += plan.missing.length > 0 ? plan.existingTurns.length : 0;
      stats.messagesToPatch += [...plan.messageIdsToPatchByTurnId.values()].reduce((sum, ids) => sum + ids.length, 0);
      stats.objectsToBuild += plan.missing.filter((turn) => turn.segment.assistantMessages.some((message) => {
        const kind = turn.segment.kindByMessageId.get(message.id);
        return kind !== "assistant_final" && kind !== "assistant_error";
      })).length;

      console.log(`[${MIGRATION_NAME}] session plan`, {
        sessionId: session.id,
        spaceId: session.spaceId,
        segments: plan.segments.length,
        missing: plan.missing.length,
        existingTurns: plan.existingTurns.length,
        messagesToPatch: [...plan.messageIdsToPatchByTurnId.values()].reduce((sum, ids) => sum + ids.length, 0),
        anomalies: plan.anomalies,
      });

      if (!args.dryRun) {
        const applied = await applySessionPlan(session, args.cutoff);
        if (applied && !args.skipObjects) {
          await backfillObjects(applied.plan);
          stats.objectsBuilt += applied.plan.missing.length;
        }
      }
    } catch (error) {
      stats.failures += 1;
      console.error(`[${MIGRATION_NAME}] failed session ${session.id}`, error);
    }
  }

  console.log(`[${MIGRATION_NAME}] completed`, stats);
  await dbClient.end({ timeout: 5 });
  process.exit(stats.failures > 0 ? 1 : 0);
};

main().catch(async (error) => {
  console.error(`[${MIGRATION_NAME}] fatal`, error);
  await dbClient.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
});
