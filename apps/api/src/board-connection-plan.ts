/**
 * Pure planner for the connection writes in a board transaction.
 *
 * Mirrors `board-node-plan` and exists for the same reason: decisions are folded
 * in memory against a prefetched snapshot so the IO is a fixed number of bulk
 * statements rather than a few queries per operation, and the semantics —
 * including the inverse operations undo depends on — stay testable without a
 * database.
 *
 * Reference integrity (do both endpoints exist? may this node be deleted while a
 * connection names it?) is deliberately *not* checked here. It belongs to
 * `contextualValidation`, which is the only place that simulates the whole
 * transaction in order and can therefore tell that a connection created in
 * operation 3 legitimately points at a node created in operation 1.
 */

import type { BoardConnection, BoardConnectionPatch, BoardOperation } from "@cohub/protocol";
import { BoardServiceError } from "./board-ops.js";

/** A connection row as prefetched, including soft-deleted ones. */
export type ExistingConnectionRow = BoardConnection & {
	deleted: boolean;
};

export type PlannedConnectionWrite = {
	connectionId: string;
	/** Full target state of the row. */
	fields: BoardConnection;
	/** True when the row should end up soft-deleted. */
	deleted: boolean;
	/** True when no row exists yet and one must be inserted. */
	isNew: boolean;
};

export type ConnectionPlan = {
	writes: PlannedConnectionWrite[];
	/**
	 * Journal entries keyed by the operation's index in the transaction, so the
	 * caller can splice them back into the full operation order.
	 */
	journal: Map<
		number,
		{
			type: string;
			payload: Record<string, unknown>;
			inverse: Record<string, unknown> | null;
		}
	>;
};

export type ConnectionPlanContext = {
	existing: Map<string, ExistingConnectionRow>;
};

/** Connection ids a transaction's connection operations mention. */
export function collectTouchedConnectionIds(
	operations: readonly BoardOperation[],
): string[] {
	const ids = new Set<string>();
	for (const operation of operations) {
		if (operation.type === "connection.create") ids.add(operation.payload.connection.id);
		else if (operation.type === "connection.patch") ids.add(operation.payload.connectionId);
		else if (operation.type === "connection.delete") ids.add(operation.payload.connectionId);
	}
	return [...ids];
}

export function isConnectionOperation(operation: BoardOperation): boolean {
	return (
		operation.type === "connection.create" ||
		operation.type === "connection.patch" ||
		operation.type === "connection.delete"
	);
}

/** Apply a patch, keeping nested routing/style objects whole-value replaced. */
function applyConnectionPatch(
	current: BoardConnection,
	patch: BoardConnectionPatch,
): BoardConnection {
	return {
		...current,
		...patch,
		// Nested groups are replaced as a unit, never deep-merged: the schema fills
		// every field of routing/style, so a partial merge would let a stale bend or
		// width survive an explicit rewrite.
		routing: patch.routing ?? current.routing,
		style: patch.style ?? current.style,
		source: patch.source ?? current.source,
		target: patch.target ?? current.target,
		id: current.id,
	};
}

/** Fold connection operations into final row states plus a journal. */
export function planConnectionWrites(
	operations: readonly BoardOperation[],
	context: ConnectionPlanContext,
): ConnectionPlan {
	const live = new Map<string, { fields: BoardConnection; deleted: boolean }>();
	const isNew = new Map<string, boolean>();
	const order: string[] = [];
	const touched = new Set<string>();
	const journal: ConnectionPlan["journal"] = new Map();

	const touch = (connectionId: string) => {
		if (touched.has(connectionId)) return;
		touched.add(connectionId);
		order.push(connectionId);
	};

	const currentOf = (connectionId: string) => {
		const staged = live.get(connectionId);
		if (staged) return staged;
		const row = context.existing.get(connectionId);
		if (!row) return null;
		const { deleted, ...fields } = row;
		return { fields: fields as BoardConnection, deleted };
	};

	for (const [opIndex, operation] of operations.entries()) {
		if (operation.type === "connection.create") {
			const connection = operation.payload.connection;
			const current = currentOf(connection.id);
			if (current && !current.deleted) {
				throw new BoardServiceError(
					409,
					`connection already exists: ${connection.id}`,
					"CONNECTION_EXISTS",
				);
			}
			// A soft-deleted row is revived in place rather than re-inserted, so an
			// undo of a delete restores the original row and its history.
			live.set(connection.id, { fields: connection, deleted: false });
			if (!isNew.has(connection.id))
				isNew.set(connection.id, !context.existing.has(connection.id));
			touch(connection.id);
			journal.set(opIndex, {
				type: operation.type,
				payload: operation.payload as unknown as Record<string, unknown>,
				inverse: { type: "connection.delete", payload: { connectionId: connection.id } },
			});
			continue;
		}

		if (operation.type === "connection.patch") {
			const connectionId = operation.payload.connectionId;
			const current = currentOf(connectionId);
			if (!current || current.deleted) {
				throw new BoardServiceError(404, "board connection not found", "CONNECTION_NOT_FOUND");
			}
			const patch = operation.payload.patch;
			const inversePatch: Record<string, unknown> = {};
			for (const key of Object.keys(patch)) {
				inversePatch[key] = current.fields[key as keyof BoardConnection];
			}
			live.set(connectionId, {
				fields: applyConnectionPatch(current.fields, patch),
				deleted: false,
			});
			if (!isNew.has(connectionId))
				isNew.set(connectionId, !context.existing.has(connectionId));
			touch(connectionId);
			journal.set(opIndex, {
				type: operation.type,
				payload: operation.payload as unknown as Record<string, unknown>,
				inverse: {
					type: "connection.patch",
					payload: { connectionId, patch: inversePatch },
				},
			});
			continue;
		}

		if (operation.type !== "connection.delete") continue;

		const connectionId = operation.payload.connectionId;
		const current = currentOf(connectionId);
		if (!current || current.deleted) {
			throw new BoardServiceError(404, "board connection not found", "CONNECTION_NOT_FOUND");
		}
		live.set(connectionId, { fields: current.fields, deleted: true });
		if (!isNew.has(connectionId))
			isNew.set(connectionId, !context.existing.has(connectionId));
		touch(connectionId);
		journal.set(opIndex, {
			type: operation.type,
			payload: operation.payload as unknown as Record<string, unknown>,
			// The inverse restores the row exactly as it was before the delete.
			inverse: { type: "connection.create", payload: { connection: current.fields } },
		});
	}

	const writes: PlannedConnectionWrite[] = [];
	for (const connectionId of order) {
		const staged = live.get(connectionId);
		if (!staged) continue;
		writes.push({
			connectionId,
			fields: staged.fields,
			deleted: staged.deleted,
			isNew: isNew.get(connectionId) ?? false,
		});
	}
	return { writes, journal };
}
