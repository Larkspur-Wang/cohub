import { parseBoardPlaybackPolicy } from "@cohub/protocol";
import type {
	BoardBootstrap,
	BoardOperation,
	BoardPlaybackPolicy,
} from "@neta-art/cohub";
import { BOARD_DOCUMENT_KIND, type BoardDocument } from "@neta-art/cohub/board";
import type {
	BoardAutomationActivity,
	BoardCollaboratorProfile,
} from "$lib/board/board-activity";
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

export type BoardRuntimeData = Pick<
	BoardBootstrap,
	"effects" | "sequences" | "clips" | "playback"
> & {
	playbackPolicy: BoardPlaybackPolicy | null;
};

export function boardRuntimeDataFromBootstrap(
	bootstrap: BoardBootstrap,
): BoardRuntimeData {
	return {
		effects: bootstrap.effects,
		sequences: bootstrap.sequences,
		clips: bootstrap.clips,
		playback: bootstrap.playback,
		playbackPolicy: parseBoardPlaybackPolicy(bootstrap.board.metadata),
	};
}

/** Runtime operations carry server-assigned revisions, so refresh them atomically. */
export function operationsRequireBoardRuntimeRefresh(
	operations: BoardOperation[],
): boolean {
	return operations.some(
		(operation) =>
			operation.type.startsWith("effect.") ||
			operation.type.startsWith("sequence.") ||
			(operation.type === "board.patch" &&
				operation.payload.patch.metadata !== undefined),
	);
}

/** Stable host contract for a complete board editor and renderer runtime. */
export type BoardRuntimeProps = {
	path: string;
	boardId: string;
	document: BoardDocument;
	runtime: BoardRuntimeData;
	spaceId: string;
	/** Keep the editor mounted while suspending input and rendering. */
	active?: boolean;
	immersive?: boolean;
	syncError?: string | null;
	/**
	 * Compact viewport. Drives the local `client.formFactor` published to peers,
	 * so a touch contact from a phone can be presented as such rather than guessed
	 * from the pointer type alone.
	 */
	isMobile?: boolean;
	/** Display identities for collaborator cursors and automation markers. */
	collaborators?: Map<string, BoardCollaboratorProfile>;
	/** Recent CLI / Agent transactions, already resolved to a board focus. */
	activities?: BoardAutomationActivity[];
	/** Open the chat turn behind an Agent marker. */
	onOpenActivity?: (activity: BoardAutomationActivity) => void | Promise<void>;
	onCommit: (
		document: BoardDocument,
		ops: BoardOperation[],
	) => void | Promise<void>;
	onRetrySync?: () => void | Promise<void>;
	onViewStateChange?: (state: BoardRuntimeViewState) => void;
	/**
	 * Open a workspace file in the preview panel. File cards on the board route
	 * here so activating one lands in the same place as clicking the file in the
	 * file tree, rather than opening a second, board-specific viewer.
	 */
	onOpenFile?: (path: string) => void | Promise<void>;
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
