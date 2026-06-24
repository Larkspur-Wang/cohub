<script lang="ts">
import type { CanvasSemanticOp } from "@neta-art/cohub";
import { onMount } from "svelte";
import { deleteCanvasItem } from "$lib/canvas/actions/canvas-document-actions";
import {
	applyCanvasOps,
	diffCanvasDocuments,
	invertCanvasOps,
} from "$lib/canvas/canvas-document";
import { getCanvasTitle } from "$lib/canvas/canvas-file";
import { clampZoom } from "$lib/canvas/canvas-geometry";
import {
	createRemoteUrlCanvasItem,
	createSpaceFileCanvasItem,
	createTextCanvasItem,
} from "$lib/canvas/canvas-items";
import type { CanvasItem, CovasDocument } from "$lib/canvas/canvas-schema";
import CanvasCardInspector from "$lib/components/canvas/CanvasCardInspector.svelte";
import CanvasEmptyState from "$lib/components/canvas/CanvasEmptyState.svelte";
import CanvasStage from "$lib/components/canvas/CanvasStage.svelte";
import CanvasToolbar from "$lib/components/canvas/CanvasToolbar.svelte";

const {
	path,
	document: initialDocument,
	saving = false,
	focused = false,
	immersive = false,
	onToggleFocus,
	onToggleImmersive,
	onCommit,
	onClose,
}: {
	path: string;
	document: CovasDocument;
	saving?: boolean;
	focused?: boolean;
	immersive?: boolean;
	onToggleFocus?: () => void;
	onToggleImmersive?: () => void;
	onCommit: (
		document: CovasDocument,
		ops: CanvasSemanticOp[],
	) => void | Promise<void>;
	onClose: () => void;
} = $props();

let documentState = $state<CovasDocument | null>(null);
let baselineDocument = $state<CovasDocument | null>(null);
let selectedItemIds = $state<string[]>([]);
let dirty = $state(false);
let saveError = $state<string | null>(null);
let undoStack = $state<CanvasSemanticOp[][]>([]);
let redoStack = $state<CanvasSemanticOp[][]>([]);

const selectedItem = $derived.by<CanvasItem | null>(() => {
	if (!documentState || selectedItemIds.length !== 1) return null;
	return (
		documentState.items.find((item) => item.id === selectedItemIds[0]) ?? null
	);
});

function loadDocument(nextDocument: CovasDocument) {
	documentState = nextDocument;
	baselineDocument = nextDocument;
	dirty = false;
	selectedItemIds = [];
}

function updateDocument(next: CovasDocument, options?: { commit?: boolean }) {
	documentState = next;
	dirty = true;
	saveError = null;
	if (options?.commit) void commit(next);
}

async function commit(
	next = documentState,
	options?: { recordUndo?: boolean },
) {
	if (!next || !baselineDocument) return;
	const ops = diffCanvasDocuments(baselineDocument, next);
	if (ops.length === 0) {
		dirty = false;
		return;
	}
	saveError = null;
	try {
		await onCommit(next, ops);
		baselineDocument = next;
		dirty = false;
		if (options?.recordUndo !== false) {
			undoStack = [...undoStack, ops];
			redoStack = [];
		}
	} catch (error) {
		saveError =
			error instanceof Error ? error.message : "Failed to sync canvas";
	}
}

function applyLocalOps(
	ops: CanvasSemanticOp[],
	options?: { recordUndo?: boolean },
) {
	if (!documentState) return;
	const next = applyCanvasOps(documentState, ops);
	documentState = next;
	dirty = true;
	void commit(next, options);
}

function undo() {
	const ops = undoStack.at(-1);
	if (!ops) return;
	undoStack = undoStack.slice(0, -1);
	redoStack = [...redoStack, ops];
	applyLocalOps(invertCanvasOps(ops), { recordUndo: false });
}

function redo() {
	const ops = redoStack.at(-1);
	if (!ops) return;
	redoStack = redoStack.slice(0, -1);
	undoStack = [...undoStack, ops];
	applyLocalOps(ops, { recordUndo: false });
}

function currentCenter() {
	if (!documentState) return { x: 96, y: 96 };
	return {
		x: (-documentState.viewport.x + 160) / documentState.viewport.zoom,
		y: (-documentState.viewport.y + 96) / documentState.viewport.zoom,
	};
}

function addFile() {
	if (!documentState) return;
	const path = prompt("Space file path");
	if (!path?.trim()) return;
	const point = currentCenter();
	updateDocument(
		{
			...documentState,
			items: [
				...documentState.items,
				createSpaceFileCanvasItem(path.trim(), point.x, point.y),
			],
		},
		{ commit: true },
	);
}

function addUrl() {
	if (!documentState) return;
	const url = prompt("Remote resource URL");
	if (!url?.trim()) return;
	try {
		new URL(url.trim());
	} catch {
		alert("Please enter a valid URL.");
		return;
	}
	const point = currentCenter();
	updateDocument(
		{
			...documentState,
			items: [
				...documentState.items,
				createRemoteUrlCanvasItem(url.trim(), point.x, point.y),
			],
		},
		{ commit: true },
	);
}

function addText() {
	if (!documentState) return;
	const text = prompt("Text note");
	if (!text?.trim()) return;
	const point = currentCenter();
	const item = createTextCanvasItem(text.trim(), point.x, point.y);
	updateDocument(
		{ ...documentState, items: [...documentState.items, item] },
		{ commit: true },
	);
	selectedItemIds = [item.id];
}

function editText(id: string) {
	if (!documentState) return;
	const item = documentState.items.find((candidate) => candidate.id === id);
	if (item?.type !== "text") return;
	const next = prompt("Edit text", item.text);
	if (next == null) return;
	updateDocument(
		{
			...documentState,
			items: documentState.items.map((candidate) =>
				candidate.id === id ? { ...candidate, text: next } : candidate,
			),
		},
		{ commit: true },
	);
}

function deleteItem(id: string) {
	if (!documentState) return;
	updateDocument(deleteCanvasItem(documentState, id), { commit: true });
	selectedItemIds = selectedItemIds.filter((selectedId) => selectedId !== id);
}

function zoomBy(factor: number) {
	if (!documentState) return;
	updateDocument({
		...documentState,
		viewport: {
			...documentState.viewport,
			zoom: clampZoom(documentState.viewport.zoom * factor),
		},
	});
}

function fit() {
	if (!documentState) return;
	updateDocument({ ...documentState, viewport: { x: 0, y: 0, zoom: 1 } });
}

function close() {
	onClose();
}

onMount(() => loadDocument(initialDocument));

$effect(() => {
	loadDocument(initialDocument);
});
</script>

<div class="flex h-full min-w-0 flex-col bg-bg-content">
  <CanvasToolbar
    title={getCanvasTitle(path)}
    {dirty}
    {saving}
    zoom={documentState?.viewport.zoom ?? 1}
    onAddFile={addFile}
    onAddUrl={addUrl}
    onAddText={addText}
    onZoomIn={() => zoomBy(1.15)}
    onZoomOut={() => zoomBy(0.85)}
    onFit={fit}
    canUndo={undoStack.length > 0}
    canRedo={redoStack.length > 0}
    onUndo={undo}
    onRedo={redo}
    {focused}
    {immersive}
    {onToggleFocus}
    {onToggleImmersive}
    onClose={close}
  />

  {#if documentState}
    {#if saveError}
      <div class="border-b border-error-soft/30 bg-error-bg px-3 py-2 text-xs text-error-soft">{saveError}</div>
    {/if}
    <div class="relative min-h-0 flex-1 bg-bg-content">
      <CanvasStage document={documentState} {selectedItemIds} onChange={updateDocument} onSelect={(ids) => selectedItemIds = ids} />
      {#if documentState.items.length === 0}
        <CanvasEmptyState onAddFile={addFile} onAddUrl={addUrl} onAddText={addText} />
      {/if}
      <CanvasCardInspector item={selectedItem} onDelete={deleteItem} onEditText={editText} />
    </div>
  {/if}
</div>
