<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import { onDestroy, onMount, untrack } from "svelte";
import { screenToWorld } from "$lib/canvas/canvas-geometry";
import type { CovasDocument } from "$lib/canvas/canvas-schema";
import { createCanvasEditor } from "$lib/canvas/editor.svelte";
import CanvasContextMenu from "$lib/components/canvas/CanvasContextMenu.svelte";
import CanvasEmptyState from "$lib/components/canvas/CanvasEmptyState.svelte";
import CanvasFloatingToolbar from "$lib/components/canvas/CanvasFloatingToolbar.svelte";
import CanvasSelectionToolbar from "$lib/components/canvas/CanvasSelectionToolbar.svelte";
import CanvasStage from "$lib/components/canvas/CanvasStage.svelte";
import CanvasTextEditor from "$lib/components/canvas/CanvasTextEditor.svelte";
import CanvasVideoPlayer from "$lib/components/canvas/CanvasVideoPlayer.svelte";
import CanvasZoomMenu from "$lib/components/canvas/CanvasZoomMenu.svelte";

const {
	path,
	document: initialDocument,
	spaceId,
	immersive = false,
	syncError = null,
	onCommit,
	onRetrySync,
	onViewStateChange,
}: {
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
	onViewStateChange?: (state: {
		path: string;
		camera: CovasDocument["viewport"];
		visibleRect: {
			x: number;
			y: number;
			width: number;
			height: number;
		} | null;
		selectedNodes: Array<{ id: string; type: string; title?: string }>;
	}) => void;
} = $props();

let stageWrap: HTMLDivElement | null = $state(null);
let contextMenu = $state<{ x: number; y: number } | null>(null);

const editor = createCanvasEditor({
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

	switch (event.key) {
		case "Delete":
		case "Backspace":
			event.preventDefault();
			editor.deleteSelection();
			return;
		case "Escape":
			if (contextMenu) contextMenu = null;
			else {
				editor.toolLocked = false;
				editor.clearSelection();
				// Leave creation tools the way tldraw does: Escape returns to Select.
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
			editor.toolLocked = false;
			return;
		case "h":
		case "H":
			editor.tool = "hand";
			editor.toolLocked = false;
			return;
		case "t":
		case "T":
			editor.tool = "text";
			return;
		case "n":
		case "N":
			editor.tool = "note";
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
	};
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	window.removeEventListener("keyup", handleKeyup);
	window.removeEventListener("blur", clearSpaceHeld);
	document.removeEventListener("visibilitychange", clearSpaceHeld);
	editor.spaceHeld = false;
	editor.destroy();
});
</script>

<div
	class="canvas-panel flex h-full min-w-0 flex-col bg-bg-primary"
	class:canvas-panel--immersive={immersive}
	data-drawer-swipe-ignore
>
	{#if syncError || editor.saveError}
		<div
			class="canvas-sync-notice flex shrink-0 items-center gap-2 border-b border-error-soft/20 bg-error-bg px-3 py-1.5 text-[11px] text-error-soft"
			class:canvas-sync-notice--immersive={immersive}
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
		<CanvasStage
			{editor}
			{spaceId}
			onSurfaceChange={(size) => { editor.surfaceSize = size; }}
		/>

		{#if !editor.hasContent}
			<CanvasEmptyState />
		{/if}

		<CanvasTextEditor {editor} />
		<CanvasVideoPlayer {editor} {spaceId} />
		<CanvasSelectionToolbar {editor} />
		<CanvasFloatingToolbar {editor} {immersive} />
		<CanvasZoomMenu {editor} {immersive} />

		{#if contextMenu}
			<CanvasContextMenu
				{editor}
				position={contextMenu}
				onClose={() => { contextMenu = null; }}
			/>
		{/if}
	</div>
</div>

<style>
	.canvas-panel--immersive {
		position: relative;
	}

	.canvas-sync-notice--immersive {
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
