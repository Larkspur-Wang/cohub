/**
 * Row → protocol mappers for Board entities.
 *
 * These live in a shared package because both the API (serving live boards) and
 * the worker (capturing checkpoint snapshots) must produce *identical* records
 * from the same rows. Two copies of a mapper is two chances for a snapshot to
 * disagree with the board it was taken from, which would surface as a Checkpoint
 * that restores subtly different data.
 */

import type {
	boardClips,
	boardCompositions,
	boardConnections,
	boardEffects,
	boardTracks,
} from "@cohub/db";
import type {
	BoardConnection,
	BoardConnectionAnchor,
	BoardConnectionDirection,
	BoardConnectionRecord,
	BoardConnectionRoutingConfig,
	BoardConnectionStyle,
	BoardAnimationTarget,
	BoardAssetRef,
	BoardComposition,
	BoardEffect,
	BoardProceduralClip,
	BoardTrack,
} from "@cohub/protocol";

type BoardConnectionRow = typeof boardConnections.$inferSelect;

function dateString(value: Date | null | undefined): string | null {
	return value?.toISOString() ?? null;
}

function portIdFromMetadata(
	metadata: Record<string, unknown>,
	key: "sourcePortId" | "targetPortId",
): string | undefined {
	const flow = metadata.boardFlow;
	if (!flow || typeof flow !== "object" || Array.isArray(flow)) return undefined;
	const value = (flow as Record<string, unknown>)[key];
	return typeof value === "string" && value ? value : undefined;
}

function connectionMetadata(connection: BoardConnection): Record<string, unknown> {
	const existing = connection.metadata.boardFlow;
	const flow =
		existing && typeof existing === "object" && !Array.isArray(existing)
			? { ...(existing as Record<string, unknown>) }
			: {};
	delete flow.sourcePortId;
	delete flow.targetPortId;
	if (connection.source.portId) flow.sourcePortId = connection.source.portId;
	if (connection.target.portId) flow.targetPortId = connection.target.portId;
	const metadata = { ...connection.metadata };
	if (Object.keys(flow).length > 0) metadata.boardFlow = flow;
	else delete metadata.boardFlow;
	return metadata;
}

/**
 * Map a connection row to its protocol record.
 *
 * The jsonb groups are cast rather than re-parsed: they were validated against the
 * schema on write, so re-validating on read would let a later schema change
 * silently rewrite stored data instead of surfacing the difference.
 */
export function boardConnectionFromRow(row: BoardConnectionRow): BoardConnectionRecord {
	const sourcePortId = portIdFromMetadata(row.metadata, "sourcePortId");
	const targetPortId = portIdFromMetadata(row.metadata, "targetPortId");
	return {
		id: row.connectionId,
		boardId: row.boardId,
		source: {
			nodeId: row.sourceNodeId,
			...(sourcePortId ? { portId: sourcePortId } : {}),
			anchor: row.sourceAnchor as unknown as BoardConnectionAnchor,
		},
		target: {
			nodeId: row.targetNodeId,
			...(targetPortId ? { portId: targetPortId } : {}),
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
export function boardEffectFromRow(row: typeof boardEffects.$inferSelect): BoardEffect {
	return {
		id: row.id,
		boardId: row.boardId,
		target: row.targetType === "item" && row.targetId
			? { type: "item", itemId: row.targetId }
			: { type: "board" },
		kind: row.kind,
		kindVersion: row.kindVersion,
		enabled: row.enabled,
		lifecycle: row.lifecycle as BoardEffect["lifecycle"],
		timeOrigin: row.timeOrigin as BoardEffect["timeOrigin"],
		layer: row.layer as BoardEffect["layer"],
		seed: row.seed,
		params: row.params,
		assetRefs: row.assetRefs as BoardAssetRef[],
		metadata: row.metadata,
		revision: row.revision,
	};
}

export function boardTrackFromRow(row: typeof boardTracks.$inferSelect): BoardTrack {
	return {
		id: row.id,
		target: row.target as BoardAnimationTarget,
		channel: row.channel,
		channelVersion: row.channelVersion,
		interpolation: row.interpolation as BoardTrack["interpolation"],
		fill: row.fill as BoardTrack["fill"],
		keyframes: row.keyframes as BoardTrack["keyframes"],
		metadata: row.metadata,
	};
}

export function boardClipFromRow(row: typeof boardClips.$inferSelect): BoardProceduralClip {
	return {
		id: row.id,
		kind: row.kind,
		kindVersion: row.kindVersion,
		target: row.target as BoardAnimationTarget,
		start: row.start,
		duration: row.duration,
		layer: row.layer as BoardProceduralClip["layer"],
		fill: row.fill as BoardProceduralClip["fill"],
		easing: row.easing as BoardProceduralClip["easing"],
		params: row.params,
		assetRefs: row.assetRefs as BoardAssetRef[],
		seed: row.seed,
		metadata: row.metadata,
	};
}

export function boardCompositionsFromRows(
	rows: Array<typeof boardCompositions.$inferSelect>,
	trackRows: Array<typeof boardTracks.$inferSelect>,
	clipRows: Array<typeof boardClips.$inferSelect>,
): BoardComposition[] {
	const tracks = new Map<string, BoardTrack[]>();
	for (const row of trackRows) {
		const list = tracks.get(row.compositionId) ?? [];
		list.push(boardTrackFromRow(row));
		tracks.set(row.compositionId, list);
	}
	const clips = new Map<string, BoardProceduralClip[]>();
	for (const row of clipRows) {
		const list = clips.get(row.compositionId) ?? [];
		list.push(boardClipFromRow(row));
		clips.set(row.compositionId, list);
	}
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		timeline: {
			duration: row.duration,
			tracks: tracks.get(row.id) ?? [],
			clips: clips.get(row.id) ?? [],
			markers: row.markers as BoardComposition["timeline"]["markers"],
		},
		playback: row.playback as BoardComposition["playback"],
		metadata: row.metadata,
		revision: row.revision,
	}));
}

export function boardCompositionInputFromRows(
	row: typeof boardCompositions.$inferSelect,
	tracks: Array<typeof boardTracks.$inferSelect>,
	clips: Array<typeof boardClips.$inferSelect>,
): Omit<BoardComposition, "revision"> {
	const [value] = boardCompositionsFromRows([row], tracks, clips);
	if (!value) throw new Error("failed to reconstruct Board composition");
	const { revision: _revision, ...composition } = value;
	return composition;
}

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
		metadata: connectionMetadata(connection),
	};
}
