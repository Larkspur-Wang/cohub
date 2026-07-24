import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { boardDocuments } from "@cohub/db";
import { isBoardPath } from "@cohub/protocol";
import { db } from "./db/index.js";
import { BoardServiceError } from "./board-ops.js";

type BoardPathRecord = {
  id: string;
  filePath: string;
  updatedAt: Date | null;
};

export type BoardPathMove = {
  id: string;
  fromPath: string;
  toPath: string;
};

export type BoardDeletePlan = BoardPathRecord[];

export function remapBoardPath(filePath: string, fromPath: string, toPath: string) {
  if (filePath === fromPath) return toPath;
  if (filePath.startsWith(`${fromPath}/`)) return `${toPath}${filePath.slice(fromPath.length)}`;
  return null;
}

function pathScope(path: string) {
  const prefix = `${path}/`;
  return or(
    eq(boardDocuments.filePath, path),
    and(gt(boardDocuments.filePath, prefix), lt(boardDocuments.filePath, `${prefix}\uffff`)),
  );
}

async function listActiveBoardPaths(spaceId: string, path: string): Promise<BoardPathRecord[]> {
  return db
    .select({
      id: boardDocuments.id,
      filePath: boardDocuments.filePath,
      updatedAt: boardDocuments.updatedAt,
    })
    .from(boardDocuments)
    .where(and(
      eq(boardDocuments.spaceId, spaceId),
      isNull(boardDocuments.deletedAt),
      pathScope(path),
    ));
}

export async function planBoardPathMove(input: {
  spaceId: string;
  fromPath: string;
  toPath: string;
}): Promise<BoardPathMove[]> {
  const documents = await listActiveBoardPaths(input.spaceId, input.fromPath);
  const moves = documents.map((document) => ({
    id: document.id,
    fromPath: document.filePath,
    toPath: remapBoardPath(document.filePath, input.fromPath, input.toPath) as string,
  }));
  for (const move of moves) {
    if (!isBoardPath(move.toPath)) {
      throw new BoardServiceError(400, "Board files must keep the .board extension");
    }
  }
  return moves;
}

export async function applyBoardPathMoves(moves: BoardPathMove[]) {
  if (moves.length === 0) return;
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const move of moves) {
      const updated = await tx
        .update(boardDocuments)
        .set({ filePath: move.toPath, updatedAt: now })
        .where(and(eq(boardDocuments.id, move.id), eq(boardDocuments.filePath, move.fromPath), isNull(boardDocuments.deletedAt)))
        .returning({ id: boardDocuments.id });
      if (updated.length !== 1) throw new BoardServiceError(409, "Board path changed during move");
    }
  });
}

export function planBoardDelete(spaceId: string, path: string): Promise<BoardDeletePlan> {
  return listActiveBoardPaths(spaceId, path);
}

export async function markBoardsDeleted(plan: BoardDeletePlan, deletedAt: Date) {
  if (plan.length === 0) return;
  await db.transaction(async (tx) => {
    for (const document of plan) {
      const updated = await tx
        .update(boardDocuments)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(boardDocuments.id, document.id), isNull(boardDocuments.deletedAt)))
        .returning({ id: boardDocuments.id });
      if (updated.length !== 1) throw new BoardServiceError(409, "Board changed during delete");
    }
  });
}

export async function restoreBoardsAfterDeleteFailure(plan: BoardDeletePlan, deletedAt: Date) {
  if (plan.length === 0) return;
  await db.transaction(async (tx) => {
    for (const document of plan) {
      await tx
        .update(boardDocuments)
        .set({ deletedAt: null, updatedAt: document.updatedAt })
        .where(and(eq(boardDocuments.id, document.id), eq(boardDocuments.deletedAt, deletedAt)));
    }
  });
}
