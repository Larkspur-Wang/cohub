import type { BoardSemanticOp } from "@neta-art/cohub";
import {
	BOARD_DOCUMENT_KIND,
	type BoardDocument,
} from "$lib/board/board-schema";
import { createLazyModuleLoader } from "$lib/lazy-module";

export type BoardRuntimeViewState = {
	path: string;
	camera: BoardDocument["viewport"];
	visibleRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	selectedNodes: Array<{ id: string; type: string; title?: string }>;
};

/** Stable host contract for a complete board editor and renderer runtime. */
export type BoardRuntimeProps = {
	path: string;
	document: BoardDocument;
	spaceId: string;
	immersive?: boolean;
	syncError?: string | null;
	onCommit: (
		document: BoardDocument,
		ops: BoardSemanticOp[],
	) => void | Promise<void>;
	onRetrySync?: () => void | Promise<void>;
	onViewStateChange?: (state: BoardRuntimeViewState) => void;
};

const loadCohubPixiRuntime = createLazyModuleLoader(
	() => import("$lib/components/board/BoardPanel.svelte"),
);

export const cohubPixiRuntime = {
	id: "cohub-pixi",
	modelKind: BOARD_DOCUMENT_KIND,
	load: loadCohubPixiRuntime,
} as const;

/** Resolve the runtime for a persisted semantic model, not for an engine name. */
export function resolveBoardRuntime(document: BoardDocument) {
	switch (document.kind) {
		case BOARD_DOCUMENT_KIND:
			return cohubPixiRuntime;
	}
}
