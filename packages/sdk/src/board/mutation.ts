import {
  BoardAppearanceSchema,
  type BoardAppearance,
} from "@cohub/protocol/board-document";

/** Merge Board appearance fields while preserving nested background/grid defaults. */
export function patchBoardAppearance(
  current: BoardAppearance,
  patch: Partial<BoardAppearance>,
): BoardAppearance {
  return BoardAppearanceSchema.parse({
    ...current,
    ...patch,
    background: patch.background ?? current.background,
    grid: patch.grid ?? current.grid,
  });
}
