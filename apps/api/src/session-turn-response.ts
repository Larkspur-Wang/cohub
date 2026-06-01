import type { SessionRecord } from "@cohub/protocol/model";
import { getSessionTurnById, hydrateTurnAuthorProfiles } from "./session-turns.js";

type SessionRow = Omit<SessionRecord, "meta" | "lastMessageAt" | "createdAt" | "updatedAt"> & {
  userUuid?: string | null;
  meta: unknown;
  lastMessageAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

const toIso = (value: Date | string | null, field: string): string => {
  if (value instanceof Date) return value.toISOString();
  if (value) return value;
  throw new Error(`session ${field} is required`);
};
const toIsoOrNull = (value: Date | string | null): string | null =>
  value instanceof Date ? value.toISOString() : value;
const normalizeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function toSessionRecord(session: SessionRow): SessionRecord {
  return {
    ...session,
    meta: normalizeRecord(session.meta),
    lastMessageAt: toIsoOrNull(session.lastMessageAt),
    createdAt: toIso(session.createdAt, "createdAt"),
    updatedAt: toIso(session.updatedAt, "updatedAt"),
  };
}

export async function buildSessionTurnResponse(session: SessionRow, turnId: string) {
  const turn = await getSessionTurnById(session.id, turnId);
  if (!turn) return null;
  const [hydratedTurn] = await hydrateTurnAuthorProfiles([turn]);
  return { session: toSessionRecord(session), turn: hydratedTurn ?? turn };
}
