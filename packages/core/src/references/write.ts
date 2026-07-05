import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { resourceReferences } from "@cohub/db";
import type { ReferenceInput } from "./types.js";

export type ReferenceDb = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Idempotently persist references. Repeated calls with the same references are
 * safe: each identity row's `count` is fully determined by its source (a
 * specific turn's content, or a single structural event), so on conflict we
 * SET the fresh values rather than accumulate. Cross-turn totals are derived by
 * SUM across rows at query time. This lets both live double-writes (including
 * retries) and backfill re-runs converge to the same state.
 *
 * The caller decides how to invoke this (typically fire-and-forget after the
 * primary transaction commits) so a stats write can never block or fail the
 * underlying behavior.
 */
export const writeReferences = async (
  db: ReferenceDb,
  references: readonly ReferenceInput[],
): Promise<void> => {
  if (references.length === 0) return;
  const now = new Date();

  // Merge within-batch duplicates so a single insert never targets the same
  // identity twice (which Postgres rejects under ON CONFLICT DO UPDATE).
  const byIdentity = new Map<string, ReferenceInput>();
  for (const ref of references) {
    const key = [
      ref.kind,
      ref.sourceType,
      ref.sourceId,
      ref.sourceTurnId ?? "",
      ref.targetType,
      ref.targetId,
    ].join("\u0000");
    const existing = byIdentity.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + (ref.count ?? 1);
      existing.meta = ref.meta ?? existing.meta;
    } else {
      byIdentity.set(key, { ...ref });
    }
  }

  const values = [...byIdentity.values()].map((ref) => ({
    kind: ref.kind,
    sourceType: ref.sourceType,
    sourceId: ref.sourceId,
    sourceTurnId: ref.sourceTurnId ?? null,
    targetType: ref.targetType,
    targetId: ref.targetId,
    spaceId: ref.spaceId,
    sessionId: ref.sessionId ?? null,
    count: ref.count ?? 1,
    meta: ref.meta ?? null,
  }));

  await db
    .insert(resourceReferences)
    .values(values)
    .onConflictDoUpdate({
      target: [
        resourceReferences.kind,
        resourceReferences.sourceType,
        resourceReferences.sourceId,
        resourceReferences.sourceTurnId,
        resourceReferences.targetType,
        resourceReferences.targetId,
      ],
      set: {
        count: sql`excluded.count`,
        meta: sql`excluded.meta`,
        updatedAt: now,
      },
    });
};

/**
 * Remove a structural reference when its underlying relationship is severed
 * (e.g. a mod is unmounted). Keeps the index consistent with source tables so
 * stale relationships do not linger in stats.
 */
export const deleteReference = async (
  db: ReferenceDb,
  identity: {
    kind: ReferenceInput["kind"];
    sourceType: ReferenceInput["sourceType"];
    sourceId: string;
    targetType: ReferenceInput["targetType"];
    targetId: string;
  },
): Promise<void> => {
  await db
    .delete(resourceReferences)
    .where(
      and(
        eq(resourceReferences.kind, identity.kind),
        eq(resourceReferences.sourceType, identity.sourceType),
        eq(resourceReferences.sourceId, identity.sourceId),
        eq(resourceReferences.targetType, identity.targetType),
        eq(resourceReferences.targetId, identity.targetId),
      ),
    );
};
