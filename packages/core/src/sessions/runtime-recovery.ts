import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sessionTurns, spaceSessions } from "@cohub/db";
import type { RuntimeRecoveryState } from "@cohub/protocol";

type Database = Pick<PostgresJsDatabase<Record<string, unknown>>, "select">;
export const runtimeRecoveryActive = inArray(sessionTurns.status, ["running", "abort_requested"]);
export const runtimeResolutionOpen = sql`coalesce(${sessionTurns.meta}->'runtimeRecovery'->>'state', '') <> 'confirmed_stopped'`;
export function readRuntimeRecovery(meta: unknown): RuntimeRecoveryState | null {
  const value = (meta as { runtimeRecovery?: RuntimeRecoveryState } | null)?.runtimeRecovery;
  return value && ["executing", "attention", "confirmed_stopped"].includes(value.state) ? value : null;
}
// This predicate matches the partial index used by the automatic safety sweep.
export const localRuntimeActive = sql`${sessionTurns.executionKind} = 'agent' and ${sessionTurns.status} in ('running', 'abort_requested') and ${sessionTurns.meta}->>'harness' in ('pi', 'codex')`;
export function listRuntimeRecoverySpaces(database: Database) {
  return database.select({ spaceId: spaceSessions.spaceId }).from(sessionTurns)
    .innerJoin(spaceSessions, eq(spaceSessions.id, sessionTurns.sessionId))
    .where(localRuntimeActive).groupBy(spaceSessions.spaceId);
}
export function listRuntimeRecoveryTurns(database: Database, spaceId: string) {
  return database.select({ id: sessionTurns.id, sessionId: sessionTurns.sessionId, userUuid: sessionTurns.userUuid, meta: sessionTurns.meta })
    .from(sessionTurns).innerJoin(spaceSessions, eq(spaceSessions.id, sessionTurns.sessionId))
    .where(and(eq(spaceSessions.spaceId, spaceId), localRuntimeActive))
    .orderBy(asc(sessionTurns.id));
}
export type RuntimeRecoveryTurn = Awaited<ReturnType<typeof listRuntimeRecoveryTurns>>[number];
export function runtimeRecoverySnapshot(turns: RuntimeRecoveryTurn[]) {
  const pending = turns.filter((turn) => readRuntimeRecovery(turn.meta)?.state === "attention");
  const revision = createHash("sha256").update(JSON.stringify(pending.map((turn) => turn.id).sort())).digest("hex");
  return { pending: pending.length, revision };
}
