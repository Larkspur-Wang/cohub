<script lang="ts">
import { onMount } from "svelte";
import { deleteCanvasItem } from "$lib/canvas/actions/canvas-document-actions";
import {
	parseCovasDocument,
	serializeCovasDocument,
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
	content,
	saving = false,
	focused = false,
	onToggleFocus,
	onSave,
	onClose,
}: {
	path: string;
	content: string;
	saving?: boolean;
	focused?: boolean;
	onToggleFocus?: () => void;
	onSave: (content: string) => void | Promise<void>;
	onClose: () => void;
} = $props();

let parseError = $state<string | null>(null);
let documentState = $state<CovasDocument | null>(null);
let selectedItemIds = $state<string[]>([]);
let dirty = $state(false);
let saveError = $state<string | null>(null);

const selectedItem = $derived.by<CanvasItem | null>(() => {
	if (!documentState || selectedItemIds.length !== 1) return null;
	return (
		documentState.items.find((item) => item.id === selectedItemIds[0]) ?? null
	);
});

function loadContent(nextContent: string) {
	const parsed = parseCovasDocument(nextContent);
	if (!parsed.ok) {
		parseError = parsed.error;
		documentState = null;
		return;
	}
	parseError = null;
	documentState = parsed.document;
	dirty = false;
	selectedItemIds = [];
}

function updateDocument(next: CovasDocument) {
	documentState = next;
	dirty = true;
	saveError = null;
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
	updateDocument({
		...documentState,
		items: [
			...documentState.items,
			createSpaceFileCanvasItem(path.trim(), point.x, point.y),
		],
	});
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
	updateDocument({
		...documentState,
		items: [
			...documentState.items,
			createRemoteUrlCanvasItem(url.trim(), point.x, point.y),
		],
	});
}

function addText() {
	if (!documentState) return;
	const text = prompt("Text note");
	if (!text?.trim()) return;
	const point = currentCenter();
	const item = createTextCanvasItem(text.trim(), point.x, point.y);
	updateDocument({ ...documentState, items: [...documentState.items, item] });
	selectedItemIds = [item.id];
}

function editText(id: string) {
	if (!documentState) return;
	const item = documentState.items.find((candidate) => candidate.id === id);
	if (!item || item.type !== "text") return;
	const next = prompt("Edit text", item.text);
	if (next == null) return;
	updateDocument({
		...documentState,
		items: documentState.items.map((candidate) =>
			candidate.id === id ? { ...candidate, text: next } : candidate,
		),
	});
}

function deleteItem(id: string) {
	if (!documentState) return;
	updateDocument(deleteCanvasItem(documentState, id));
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

async function save() {
	if (!documentState || !dirty) return;
	saveError = null;
	try {
		await onSave(serializeCovasDocument(documentState));
		dirty = false;
	} catch (error) {
		saveError =
			error instanceof Error ? error.message : "Failed to save canvas";
	}
}

function close() {
	if (dirty && !confirm("Close canvas without saving changes?")) return;
	onClose();
}

onMount(() => loadContent(content));

$effect(() => {
	loadContent(content);
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
    {focused}
    {onToggleFocus}
    onSave={() => void save()}
    onClose={close}
  />

  {#if parseError}
    <div class="m-4 rounded-lg border border-error-soft/30 bg-error-bg p-4 text-sm text-error-soft">
      <div class="font-medium">Cannot open canvas</div>
      <div class="mt-1 text-xs">{parseError}</div>
    </div>
  {:else if documentState}
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
  {:else}
    <div class="flex flex-1 items-center justify-center text-xs text-text-tertiary">Loading canvas…</div>
  {/if}
</div>
