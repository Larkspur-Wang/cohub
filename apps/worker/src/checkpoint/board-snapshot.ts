import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  boardClips,
  boardCompositions,
  boardConnections,
  boardEffects,
  boardNodes,
  boardTracks,
  boards,
} from "@cohub/db";
import {
  BOARD_PROTOCOL_VERSION,
  BOARD_SNAPSHOT_KIND,
  type BoardSnapshot,
} from "@cohub/protocol";
import {
  boardCompositionsFromRows,
  boardConnectionFromRow,
  boardEffectFromRow,
} from "@cohub/core/board";
import { db } from "../db.js";

const dateString = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Capture one repeatable-read snapshot; published Works and Checkpoints share it. */
export async function captureBoardSnapshots(input: {
  spaceId: string;
  boardIds?: string[];
}): Promise<BoardSnapshot[]> {
  return db.transaction(async (tx) => {
    if (input.boardIds?.length === 0) return [];
    const boardWhere = input.boardIds
      ? and(eq(boards.spaceId, input.spaceId), inArray(boards.id, input.boardIds))
      : eq(boards.spaceId, input.spaceId);
    const sourceBoards = await tx.select().from(boards).where(boardWhere).orderBy(boards.id);
    const capturedAt = new Date().toISOString();
    const snapshots: BoardSnapshot[] = [];

    for (const board of sourceBoards) {
      const [nodes, connections, effects, compositions, tracks, clips] = await Promise.all([
        tx.select().from(boardNodes)
          .where(and(eq(boardNodes.boardId, board.id), isNull(boardNodes.deletedAt)))
          .orderBy(boardNodes.orderKey),
        tx.select().from(boardConnections)
          .where(and(eq(boardConnections.boardId, board.id), isNull(boardConnections.deletedAt)))
          .orderBy(boardConnections.connectionId),
        tx.select().from(boardEffects).where(eq(boardEffects.boardId, board.id)),
        tx.select().from(boardCompositions).where(eq(boardCompositions.boardId, board.id)),
        tx.select().from(boardTracks).where(eq(boardTracks.boardId, board.id)).orderBy(boardTracks.compositionId, boardTracks.id),
        tx.select().from(boardClips).where(eq(boardClips.boardId, board.id)).orderBy(boardClips.compositionId, boardClips.start),
      ]);
      snapshots.push({
        kind: BOARD_SNAPSHOT_KIND,
        version: BOARD_PROTOCOL_VERSION,
        capturedAt,
        board: {
          id: board.id,
          spaceId: board.spaceId,
          title: board.title,
          version: board.version,
          metadata: board.metadata,
          createdAt: dateString(board.createdAt),
          updatedAt: dateString(board.updatedAt),
        },
        nodes: nodes.map(({ deletedAt: _deletedAt, ...node }) => ({
          ...node,
          createdAt: dateString(node.createdAt),
          updatedAt: dateString(node.updatedAt),
        })),
        connections: connections.map(boardConnectionFromRow),
        effects: effects.map(boardEffectFromRow),
        compositions: boardCompositionsFromRows(compositions, tracks, clips),
        playback: null,
      });
    }
    return snapshots;
  }, { isolationLevel: "repeatable read" });
}
