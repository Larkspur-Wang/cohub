export type SnapshotConnection = {
  id: unknown;
  source?: { itemId?: unknown; anchor?: unknown };
  target?: { itemId?: unknown; anchor?: unknown };
  relation?: unknown;
  direction?: unknown;
  label?: unknown;
  routing?: unknown;
  style?: unknown;
  metadata?: unknown;
  revision?: unknown;
};

/** Convert semantic snapshot connections to storage values after endpoint validation. */
export function restoreBoardConnectionRows(
  connections: SnapshotConnection[],
  boardId: string,
  restoredItemIds: ReadonlySet<string>,
  now: Date,
) {
  const anchor = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { kind: "auto" };
  const group = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return connections.filter((connection) =>
    typeof connection.source?.itemId === "string" &&
    typeof connection.target?.itemId === "string" &&
    restoredItemIds.has(connection.source.itemId) &&
    restoredItemIds.has(connection.target.itemId),
  ).map((connection) => ({
    boardId,
    connectionId: String(connection.id),
    sourceNodeId: connection.source?.itemId as string,
    targetNodeId: connection.target?.itemId as string,
    relation: typeof connection.relation === "string" ? connection.relation : "related",
    direction: typeof connection.direction === "string" ? connection.direction : "forward",
    label: typeof connection.label === "string" ? connection.label : "",
    sourceAnchor: anchor(connection.source?.anchor),
    targetAnchor: anchor(connection.target?.anchor),
    routing: group(connection.routing),
    style: group(connection.style),
    metadata: group(connection.metadata),
    revision: Number(connection.revision ?? 0),
    createdAt: now,
    updatedAt: now,
  }));
}
