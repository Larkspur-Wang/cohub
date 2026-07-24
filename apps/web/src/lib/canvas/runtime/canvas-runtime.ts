import type { CanvasSemanticOp } from "@neta-art/cohub";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { createLazyModuleLoader } from "$lib/lazy-module";

export type CanvasRuntimeViewState = {
	path: string;
	camera: CovasDocument["viewport"];
	visibleRect: {
		x: number;
		y: number;
		width: number;
		height: number;
	} | null;
	selectedNodes: Array<{ id: string; type: string; title?: string }>;
};

/** Stable host contract for a complete canvas editor and renderer runtime. */
export type CanvasRuntimeProps = {
	path: string;
	document: CovasDocument;
	spaceId: string;
	immersive?: boolean;
	syncError?: string | null;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onRetrySync?: () => void | Promise<void>;
	onViewStateChange?: (state: CanvasRuntimeViewState) => void;
};

const loadCohubPixiRuntime = createLazyModuleLoader(
	() => import("$lib/components/canvas/CanvasPanel.svelte"),
);

export const cohubPixiRuntime = {
	id: "cohub-pixi",
	modelKind: "cohub.canvas",
	load: loadCohubPixiRuntime,
} as const;

/** Resolve the runtime for a persisted semantic model, not for an engine name. */
export function resolveCanvasRuntime(document: CovasDocument) {
	switch (document.kind) {
		case "cohub.canvas":
			return cohubPixiRuntime;
	}
}
