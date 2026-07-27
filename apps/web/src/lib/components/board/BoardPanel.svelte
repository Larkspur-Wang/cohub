<script lang="ts">
import { screenToWorld, shapeCapabilities } from "@neta-art/cohub/board";
import { onDestroy, onMount, untrack } from "svelte";
import {
	type BoardAwarenessController,
	createBoardAwarenessController,
} from "$lib/board/board-awareness";
import type { BoardStageExportBridge } from "$lib/board/board-image-export";
import { createBoardEditor } from "$lib/board/editor.svelte";
import type { BoardRuntimeProps } from "$lib/board/runtime/board-runtime";
import BoardCollaboratorOverlay from "$lib/components/board/BoardCollaboratorOverlay.svelte";
import BoardContextMenu from "$lib/components/board/BoardContextMenu.svelte";
import BoardEmptyState from "$lib/components/board/BoardEmptyState.svelte";
import BoardExportDialog from "$lib/components/board/BoardExportDialog.svelte";
import BoardFloatingToolbar from "$lib/components/board/BoardFloatingToolbar.svelte";
import BoardSelectionToolbar from "$lib/components/board/BoardSelectionToolbar.svelte";
import BoardStage from "$lib/components/board/BoardStage.svelte";
import BoardTextEditor from "$lib/components/board/BoardTextEditor.svelte";
import BoardVideoPlayer from "$lib/components/board/BoardVideoPlayer.svelte";
import BoardZoomMenu from "$lib/components/board/BoardZoomMenu.svelte";
import { sdk } from "$lib/sdk";

const {
	path,
	boardId,
	document: initialDocument,
	runtime,
	spaceId,
	immersive = false,
	syncError = null,
	isMobile = false,
	collaborators = new Map(),
	activities = [],
	onOpenActivity,
	onCommit,
	onRetrySync,
	onViewStateChange,
	onOpenFile,
}: BoardRuntimeProps = $props();

let stageWrap: HTMLDivElement | null = $state(null);
let contextMenu = $state<{ x: number; y: number } | null>(null);
/**
 * Export runs on the stage's live renderer, so the dialog only opens once the
 * stage has handed over its bridge.
 */
let exportBridge = $state<BoardStageExportBridge | null>(null);
let exportOpen = $state(false);
let awarenessVersion = $state(0);
let surfaceSize = $state<{ width: number; height: number }>({
	width: 0,
	height: 0,
});
let unsubscribeAwareness: (() => void) | null = null;

function openExport() {
	if (!exportBridge) return;
	contextMenu = null;
	exportOpen = true;
}

const boardClient = sdk
	.space(untrack(() => spaceId))
	.board(untrack(() => boardId));
const awareness: BoardAwarenessController = createBoardAwarenessController({
	send: (seq, update) => boardClient.updateAwareness(seq, update),
	onChange: () => {
		awarenessVersion += 1;
	},
});

const editor = createBoardEditor({
	document: untrack(() => initialDocument),
	key: untrack(() => path),
	onCommit: (document, ops) => onCommit(document, ops),
	onViewStateChange: (state) => {
		onViewStateChange?.({ path, ...state });
	},
});

$effect(() => {
	const doc = initialDocument;
	const k = path;
	// untrack: only re-run when the document/path prop changes, not when
	// loadDocument reads interaction/editing state for its deferral decision.
	untrack(() => editor.loadDocument(doc, k));
});

$effect(() => {
	const tool = editor.tool;
	const selection = editor.selection;
	const bounds = editor.bounds;
	const editingId = editor.editingId;
	// Form factor is published, not inferred by peers: a touch contact from a
	// phone and one from a touchscreen laptop are the same pointer type but not
	// the same situation.
	const formFactor = isMobile ? ("mobile" as const) : ("desktop" as const);
	untrack(() =>
		awareness.updateLocalState({
			client: { formFactor },
			tool,
			selection,
			bounds,
			editingId,
		}),
	);
});

$effect(() => {
	editor.interaction;
	editor.geometryVersion;
	untrack(() => awareness.syncGesture(editor));
});

$effect(() => {
	awarenessVersion;
	const items = editor.items;
	untrack(() => awareness.reconcile(items));
});

// Activity state is space-wide, so scope it to this board: switching boards must
// not carry a marker from the previous one onto unrelated content.
const boardActivities = $derived(
	activities.filter((activity) => activity.boardId === boardId),
);

// awarenessVersion is the change signal for the peer map, which is mutated in
// place by the controller.
const peers = $derived.by(() => {
	awarenessVersion;
	return awareness.peers;
});

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		target.isContentEditable
	);
}

async function writeClipboard(payload: unknown) {
	const text = JSON.stringify(payload);
	try {
		if (navigator.clipboard?.writeText)
			await navigator.clipboard.writeText(text);
	} catch {
		// Internal clipboard on the editor is enough as a fallback.
	}
}

async function readClipboardText(): Promise<string | null> {
	try {
		if (navigator.clipboard?.readText)
			return await navigator.clipboard.readText();
	} catch {
		/* permission denied / insecure context */
	}
	return null;
}

function handleKeydown(event: KeyboardEvent) {
	if (editor.editingId) return;
	if (isEditableTarget(event.target)) return;
	const mod = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();

	// Space temporary hand — ignore auto-repeat.
	if (event.code === "Space" && !event.repeat) {
		event.preventDefault();
		editor.spaceHeld = true;
		return;
	}

	if (mod && key === "z") {
		event.preventDefault();
		if (event.shiftKey) editor.redo();
		else editor.undo();
		return;
	}
	if (mod && key === "y") {
		event.preventDefault();
		editor.redo();
		return;
	}
	if (mod && key === "d") {
		event.preventDefault();
		editor.duplicateSelection();
		return;
	}
	if (mod && key === "a") {
		event.preventDefault();
		editor.selectAll();
		return;
	}
	if (mod && key === "c") {
		const payload = editor.copySelection();
		if (payload) {
			event.preventDefault();
			void writeClipboard(payload);
		}
		return;
	}
	if (mod && key === "x") {
		const payload = editor.cutSelection();
		if (payload) {
			event.preventDefault();
			void writeClipboard(payload);
		}
		return;
	}
	if (mod && key === "v") {
		event.preventDefault();
		void (async () => {
			const text = await readClipboardText();
			if (text) {
				// pasteClipboard re-validates; invalid JSON / payload is ignored.
				editor.pasteClipboard(text);
				return;
			}
			editor.pasteClipboard();
		})();
		return;
	}
	if (mod && event.key === "0") {
		event.preventDefault();
		editor.fitView();
		return;
	}
	if (mod && key === "l") {
		event.preventDefault();
		editor.toggleSelectionLock();
		return;
	}
	// Shift+Cmd/Ctrl+E — export image. Plain Cmd+E is the browser's own in some
	// builds, and the shift form matches the "export" convention in design tools.
	if (mod && event.shiftKey && key === "e") {
		event.preventDefault();
		openExport();
		return;
	}

	switch (event.key) {
		case "Enter": {
			// Keyboard equivalent of double-clicking a card: open a file card in the
			// preview panel, or start editing an editable shape.
			const single =
				editor.selectedItems.length === 1 ? editor.selectedItems[0] : null;
			if (!single) return;
			event.preventDefault();
			if (single.type === "file") {
				void onOpenFile?.(single.ref.path);
				return;
			}
			if (!single.locked && shapeCapabilities(single).canEdit)
				editor.editingId = single.id;
			return;
		}
		case "Delete":
		case "Backspace":
			event.preventDefault();
			editor.deleteSelection();
			return;
		case "Escape":
			if (contextMenu) contextMenu = null;
			else {
				editor.clearSelection();
				// Escape leaves any creation tool and returns to Select.
				if (editor.tool !== "select" && editor.tool !== "hand")
					editor.tool = "select";
			}
			return;
		case "ArrowUp":
			event.preventDefault();
			editor.nudgeSelection(0, -1, event.shiftKey);
			return;
		case "ArrowDown":
			event.preventDefault();
			editor.nudgeSelection(0, 1, event.shiftKey);
			return;
		case "ArrowLeft":
			event.preventDefault();
			editor.nudgeSelection(-1, 0, event.shiftKey);
			return;
		case "ArrowRight":
			event.preventDefault();
			editor.nudgeSelection(1, 0, event.shiftKey);
			return;
		case "v":
		case "V":
			editor.tool = "select";
			return;
		case "h":
		case "H":
			editor.tool = "hand";
			return;
		case "t":
		case "T":
			editor.tool = "text";
			return;
		case "g":
		case "G":
			editor.tool = "geo";
			return;
		case "d":
		case "D":
			editor.tool = "draw";
			return;
		case "a":
		case "A":
			editor.tool = "arrow";
			return;
		case "f":
		case "F":
			editor.tool = "frame";
			return;
		case "/":
			event.preventDefault();
			editor.fitView();
			return;
	}
}

function handleKeyup(event: KeyboardEvent) {
	if (event.code === "Space") {
		editor.spaceHeld = false;
	}
}

function clearSpaceHeld() {
	editor.spaceHeld = false;
	awareness.setCursor(null);
}

function retrySync() {
	if (editor.saveError) {
		editor.retrySave();
		return;
	}
	void onRetrySync?.();
}

function handleContextMenu(event: MouseEvent) {
	event.preventDefault();
	if (!stageWrap) return;
	const rect = stageWrap.getBoundingClientRect();
	const worldPoint = screenToWorld(
		event.clientX,
		event.clientY,
		rect,
		editor.camera,
	);
	const item = editor.itemAt(worldPoint);
	if (item && !editor.selection.includes(item.id))
		editor.setSelection([item.id]);
	if (!item && editor.selection.length > 0) editor.clearSelection();
	contextMenu = { x: event.clientX, y: event.clientY };
}

onMount(() => {
	unsubscribeAwareness = boardClient.subscribe({
		awareness: (event) => awareness.receive(event),
	});
	window.addEventListener("keydown", handleKeydown);
	window.addEventListener("keyup", handleKeyup);
	// Space hand can stick if the window blurs mid-hold (tab switch / alt-tab).
	window.addEventListener("blur", clearSpaceHeld);
	document.addEventListener("visibilitychange", clearSpaceHeld);
	return () => {
		window.removeEventListener("keydown", handleKeydown);
		window.removeEventListener("keyup", handleKeyup);
		window.removeEventListener("blur", clearSpaceHeld);
		document.removeEventListener("visibilitychange", clearSpaceHeld);
		const unsubscribe = unsubscribeAwareness;
		unsubscribeAwareness = null;
		void awareness.destroy().finally(() => unsubscribe?.());
	};
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	window.removeEventListener("keyup", handleKeyup);
	window.removeEventListener("blur", clearSpaceHeld);
	document.removeEventListener("visibilitychange", clearSpaceHeld);
	editor.spaceHeld = false;
	const unsubscribe = unsubscribeAwareness;
	unsubscribeAwareness = null;
	void awareness.destroy().finally(() => unsubscribe?.());
	editor.destroy();
});
</script>

<div
	class="board-panel flex h-full min-w-0 flex-col bg-bg-primary"
	class:board-panel--immersive={immersive}
	data-drawer-swipe-ignore
>
	{#if syncError || editor.saveError}
		<div
			class="board-sync-notice flex shrink-0 items-center gap-2 border-b border-error-soft/20 bg-error-bg px-3 py-1.5 text-[11px] text-error-soft"
			class:board-sync-notice--immersive={immersive}
		>
			<span class="min-w-0 flex-1 truncate">Sync paused</span>
			<button type="button" class="action-btn" onclick={retrySync}>Retry</button>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={stageWrap}
		class="relative min-h-0 flex-1 bg-bg-primary"
		oncontextmenu={handleContextMenu}
	>
		<BoardStage
			{editor}
			{runtime}
			{awareness}
			{awarenessVersion}
			{spaceId}
			{onOpenFile}
			onPointerPresence={(cursor) => awareness.setCursor(cursor)}
			onSurfaceChange={(size) => { editor.surfaceSize = size; surfaceSize = size; }}
			onExportReady={(bridge) => { exportBridge = bridge; }}
		/>

		<BoardCollaboratorOverlay
			peers={peers}
			activities={boardActivities}
			profiles={collaborators}
			camera={editor.camera}
			surface={surfaceSize}
			cursorVisibleMs={awareness.cursorVisibleMs}
			{isMobile}
			onOpenActivity={(activity) => { void onOpenActivity?.(activity); }}
		/>

		{#if !editor.hasContent}
			<BoardEmptyState />
		{/if}

		<BoardTextEditor {editor} />
		<BoardVideoPlayer {editor} {spaceId} />
		<BoardSelectionToolbar {editor} />
		<BoardFloatingToolbar {editor} {immersive} />
		<BoardZoomMenu {editor} {immersive} />

		{#if contextMenu}
			<BoardContextMenu
				{editor}
				{onOpenFile}
				position={contextMenu}
				onExport={exportBridge ? openExport : undefined}
				onClose={() => { contextMenu = null; }}
			/>
		{/if}
	</div>
</div>

<BoardExportDialog
	open={exportOpen}
	onClose={() => { exportOpen = false; }}
	document={editor.document}
	bridge={exportBridge}
	title={path}
	selection={editor.selection}
/>

<style>
	.board-panel--immersive {
		position: relative;
	}

	.board-sync-notice--immersive {
		position: absolute;
		top: 58px;
		right: var(--preview-safe-right, 10px);
		z-index: 30;
		max-width: min(420px, calc(100% - var(--preview-safe-left, 10px) - var(--preview-safe-right, 10px)));
		border: 1px solid var(--error-soft);
		border-radius: 7px;
		box-shadow: 0 8px 20px color-mix(in srgb, var(--overlay-scrim-strong) 12%, transparent);
	}
</style>
