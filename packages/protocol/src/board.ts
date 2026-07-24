export const BOARD_EXTENSION = ".board" as const;
export const BOARD_MIME_TYPE = "application/json" as const;
export const BOARD_DOCUMENT_KIND = "cohub.board" as const;
export const BOARD_MANIFEST_KIND = "cohub.board.manifest" as const;
export const BOARD_CHECKPOINT_KIND = "cohub.board.checkpoint" as const;
export const BOARD_CLIPBOARD_KIND = "cohub.board.clipboard" as const;
export const BOARD_CLIPBOARD_MIME = "application/x-cohub-board" as const;

export function isBoardPath(path: string) {
  return path.toLowerCase().endsWith(BOARD_EXTENSION);
}
