import type { PreviewSyncStatus } from "./preview-sync-status";

export type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	syncStatus?: PreviewSyncStatus;
	active: boolean;
};

export function activePreviewFilePath(
	kind: PreviewTab["kind"] | null,
	filePath: string | null,
	canvasPath: string | null,
): string {
	if (kind === "file") return filePath ?? "";
	if (kind === "canvas") return canvasPath ?? "";
	return "";
}
