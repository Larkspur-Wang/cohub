import type { PreviewSyncStatus } from "./preview-sync-status";

export type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	syncStatus?: PreviewSyncStatus;
	active: boolean;
};
