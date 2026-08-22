import { isBoardFile } from "$lib/board/board-file";
import type { WindowSyncStatus } from "./window-sync-status";

export type Window = {
	kind: "file" | "board" | "port" | "app";
	key: string;
	label: string;
	title: string;
	syncStatus?: WindowSyncStatus;
	active: boolean;
};

export function activeWindowFilePath(
	kind: Window["kind"] | null,
	filePath: string | null,
	boardPath: string | null,
): string {
	if (kind === "file") return filePath ?? "";
	if (kind === "board") return boardPath ?? "";
	return "";
}

export function workspaceFilePreviewKind(
	path: string,
	readOnly: boolean,
): "file" | "board" {
	return isBoardFile(path) && !readOnly ? "board" : "file";
}
