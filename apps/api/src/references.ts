import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import * as schema from "@cohub/db";
import type { ReferenceKind, ReferenceResourceType } from "@cohub/db";

/** A resource selector like "session:<id>" parsed into its parts. */
export type ResourceRef = {
  type: QueryableResourceType;
  id: string;
};

/**
 * Resource types that can be used as a query `source`: they have an owning
 * space to authorize against and a UUID id. Other types (user/file/tool) only
 * ever appear as reference *targets*, never as a queryable source.
 */
export type QueryableResourceType = "space" | "session" | "checkpoint";

const QUERYABLE_RESOURCE_TYPES: readonly QueryableResourceType[] = [
  "space",
  "session",
  "checkpoint",
];

const REFERENCE_KINDS: readonly ReferenceKind[] = [
  "session_fork",
  "space_fork",
  "checkpoint_fork",
  "mention",
  "tool_call",
  "mod",
  "participant",
];

export type ReferenceDirection = "out" | "in" | "both";

/** Parse "type:id" into a validated resource ref, or null if malformed. */
export const parseResourceRef = (value: string | undefined | null): ResourceRef | null => {
  if (!value) return null;
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const type = value.slice(0, idx) as QueryableResourceType;
  const id = value.slice(idx + 1).trim();
  if (!id || !QUERYABLE_RESOURCE_TYPES.includes(type)) return null;
  return { type, id };
};

/**
 * Parse a comma-separated list of kinds. Returns the valid kinds and any
 * unrecognized tokens so callers can reject bad input rather than silently
 * widening the query to all kinds.
 */
export const parseKinds = (
  value: string | undefined | null,
): { kinds: ReferenceKind[]; invalid: string[] } => {
  if (!value) return { kinds: [], invalid: [] };
  const kinds: ReferenceKind[] = [];
  const invalid: string[] = [];
  for (const raw of value.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (REFERENCE_KINDS.includes(part as ReferenceKind)) kinds.push(part as ReferenceKind);
    else invalid.push(part);
  }
  return { kinds, invalid };
};

export const parseDirection = (value: string | undefined | null): ReferenceDirection =>
  value === "in" || value === "both" ? value : value === "out" ? "out" : "both";

export type ReferenceRow = {
  kind: ReferenceKind;
  sourceType: ReferenceResourceType;
  sourceId: string;
  sourceTurnId: string | null;
  targetType: ReferenceResourceType;
  targetId: string;
  spaceId: string;
  sessionId: string | null;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  meta: Record<string, unknown> | null;
};

const REFERENCE_COLUMNS = {
  kind: schema.resourceReferences.kind,
  sourceType: schema.resourceReferences.sourceType,
  sourceId: schema.resourceReferences.sourceId,
  sourceTurnId: schema.resourceReferences.sourceTurnId,
  targetType: schema.resourceReferences.targetType,
  targetId: schema.resourceReferences.targetId,
  spaceId: schema.resourceReferences.spaceId,
  sessionId: schema.resourceReferences.sessionId,
  count: schema.resourceReferences.count,
  createdAt: schema.resourceReferences.createdAt,
  updatedAt: schema.resourceReferences.updatedAt,
  meta: schema.resourceReferences.meta,
} as const;

/**
 * List references touching a resource. Direction selects whether the resource
 * is the source ("out": what it references), the target ("in": what references
 * it), or both. Neutral by design: callers assemble graphs, lists, or rankings
 * from the returned rows.
 */
export const queryReferences = async (input: {
  ref: ResourceRef;
  direction: ReferenceDirection;
  kinds?: ReferenceKind[];
  since?: Date | null;
  limit: number;
  /**
   * Gate for incoming references, which originate in other spaces. Return true
   * only for spaces the caller may view, so "who references me" never leaks
   * source ids from private spaces. Outgoing references share the authorized
   * resource's own space and are always allowed.
   */
  canViewSpace?: (spaceId: string) => Promise<boolean>;
}): Promise<ReferenceRow[]> => {
  const { ref, direction, kinds, since, limit, canViewSpace } = input;
  const kindFilter = kinds && kinds.length > 0 ? inArray(schema.resourceReferences.kind, kinds) : undefined;
  const sinceFilter = since ? gte(schema.resourceReferences.updatedAt, since) : undefined;

  const outWhere = and(
    eq(schema.resourceReferences.sourceType, ref.type),
    eq(schema.resourceReferences.sourceId, ref.id),
    kindFilter,
    sinceFilter,
  );
  const inWhere = and(
    eq(schema.resourceReferences.targetType, ref.type),
    eq(schema.resourceReferences.targetId, ref.id),
    kindFilter,
    sinceFilter,
  );

  const runQuery = (where: ReturnType<typeof and>) =>
    db
      .select(REFERENCE_COLUMNS)
      .from(schema.resourceReferences)
      .where(where)
      .orderBy(desc(schema.resourceReferences.updatedAt))
      .limit(limit);

  // Incoming references come from other spaces, so filter them by visibility.
  const filterVisible = async (rows: ReferenceRow[]): Promise<ReferenceRow[]> => {
    if (!canViewSpace) return rows;
    const decisions = new Map<string, boolean>();
    const visible: ReferenceRow[] = [];
    for (const row of rows) {
      let allowed = decisions.get(row.spaceId);
      if (allowed === undefined) {
        allowed = await canViewSpace(row.spaceId);
        decisions.set(row.spaceId, allowed);
      }
      if (allowed) visible.push(row);
    }
    return visible;
  };

  if (direction === "out") return runQuery(outWhere) as Promise<ReferenceRow[]>;
  if (direction === "in") return filterVisible((await runQuery(inWhere)) as ReferenceRow[]);

  const [out, incomingRaw] = await Promise.all([runQuery(outWhere), runQuery(inWhere)]);
  const incoming = await filterVisible(incomingRaw as ReferenceRow[]);
  // Merge, de-dupe by row identity, keep most recent first, cap at limit.
  const seen = new Set<string>();
  const merged: ReferenceRow[] = [];
  for (const row of [...(out as ReferenceRow[]), ...incoming]) {
    const key = `${row.kind}|${row.sourceType}:${row.sourceId}|${row.sourceTurnId ?? ""}|${row.targetType}:${row.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return merged.slice(0, limit);
};

export type AggregateGroupBy = "kind" | "targetType" | "sourceType" | "day";

export const parseGroupBy = (value: string | undefined | null): AggregateGroupBy => {
  if (value === "targetType" || value === "sourceType" || value === "day") return value;
  return "kind";
};

export type AggregateRow = {
  group: string;
  references: number;
  total: number;
};

/**
 * Aggregate references for a space into grouped counts. `references` is the row
 * count, `total` sums the per-row occurrence counts. Powers distributions,
 * influence rankings, and time trends from one endpoint.
 */
export const aggregateReferences = async (input: {
  spaceId: string;
  groupBy: AggregateGroupBy;
  kinds?: ReferenceKind[];
  since?: Date | null;
}): Promise<AggregateRow[]> => {
  const { spaceId, groupBy, kinds, since } = input;
  const kindFilter = kinds && kinds.length > 0 ? inArray(schema.resourceReferences.kind, kinds) : undefined;
  const sinceFilter = since ? gte(schema.resourceReferences.updatedAt, since) : undefined;
  const where = and(eq(schema.resourceReferences.spaceId, spaceId), kindFilter, sinceFilter);

  const groupExpr =
    groupBy === "targetType"
      ? sql<string>`${schema.resourceReferences.targetType}`
      : groupBy === "sourceType"
        ? sql<string>`${schema.resourceReferences.sourceType}`
        : groupBy === "day"
          ? sql<string>`to_char(date_trunc('day', ${schema.resourceReferences.updatedAt}), 'YYYY-MM-DD')`
          : sql<string>`${schema.resourceReferences.kind}`;

  const rows = await db
    .select({
      group: groupExpr.as("group"),
      references: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${schema.resourceReferences.count}), 0)::int`,
    })
    .from(schema.resourceReferences)
    .where(where)
    .groupBy(groupExpr)
    .orderBy(desc(sql`count(*)`));

  return rows as AggregateRow[];
};
