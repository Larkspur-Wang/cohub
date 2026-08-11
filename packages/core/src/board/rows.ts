/**
 * Row → protocol mappers for Board entities.
 *
 * These live in a shared package because both the API (serving live boards) and
 * the worker (capturing checkpoint snapshots) must produce *identical* records
 * from the same rows. Two copies of a mapper is two chances for a snapshot to
 * disagree with the board it was taken from, which would surface as a Checkpoint
 * that restores subtly different data.
 */

import type { boardConnections } from "@cohub/db";
import type {
	BoardConnection,
	BoardConnectionAnchor,
	BoardConnectionDirection,
	BoardConnectionRecord,
	BoardConnectionRoutingConfig,
	BoardConnectionStyle,
} from "@cohub/protocol";

type BoardConnectionRow = typeof boardConnections.$inferSelect;

function dateString(value: Date | null | undefined): string | null {
	return value?.toISOString() ?? null;
}

/**
 * Map a connection row to its protocol record.
 *
 * The jsonb groups are cast rather than re-parsed: they were validated against the
 * schema on write, so re-validating on read would let a later schema change
 * silently rewrite stored data instead of surfacing the difference.
 */
export function boardConnectionFromRow(row: BoardConnectionRow): BoardConnectionRecord {
	return {
		id: row.connectionId,
		boardId: row.boardId,
		source: {
			nodeId: row.sourceNodeId,
			anchor: row.sourceAnchor as unknown as BoardConnectionAnchor,
		},
		target: {
			nodeId: row.targetNodeId,
			anchor: row.targetAnchor as unknown as BoardConnectionAnchor,
		},
		relation: row.relation,
		direction: row.direction as BoardConnectionDirection,
		label: row.label,
		routing: row.routing as unknown as BoardConnectionRoutingConfig,
		style: row.style as unknown as BoardConnectionStyle,
		metadata: row.metadata,
		revision: row.revision,
		createdAt: dateString(row.createdAt),
		updatedAt: dateString(row.updatedAt),
	};
}

/** Flatten a connection into its row columns (identity-owned fields excluded). */
export function boardConnectionValues(boardId: string, connection: BoardConnection) {
	return {
		boardId,
		connectionId: connection.id,
		sourceNodeId: connection.source.nodeId,
		targetNodeId: connection.target.nodeId,
		relation: connection.relation,
		direction: connection.direction,
		label: connection.label,
		sourceAnchor: connection.source.anchor as unknown as Record<string, unknown>,
		targetAnchor: connection.target.anchor as unknown as Record<string, unknown>,
		routing: connection.routing as unknown as Record<string, unknown>,
		style: connection.style as unknown as Record<string, unknown>,
		metadata: connection.metadata,
	};
}
