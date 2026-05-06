<script lang="ts">
import {
	File as FileIcon,
	Folder,
	FolderOpen,
	FolderPlus,
	Pencil,
	Pin,
	PinOff,
	Plus,
	Trash2,
	Upload,
} from "lucide-svelte";
import FsTreeItem from "$lib/components/FsTreeItem.svelte";
import type { SpaceFsNode } from "$lib/space-fs";

const {
	node,
	depth,
	selectedPath,
	onToggle,
	onSelect,
	onCreateFile,
	onCreateDir,
	onRename,
	onDelete,
	onUpload,
	isPinned,
	onTogglePin,
	onInsertReference,
	draggable = true,
	showItemActions = true,
	canWrite = true,
}: {
	node: SpaceFsNode;
	depth: number;
	selectedPath: string;
	onToggle: (node: SpaceFsNode) => void;
	onSelect: (node: SpaceFsNode) => void;
	onCreateFile: (parentPath: string) => void;
	onCreateDir: (parentPath: string) => void;
	onRename: (node: SpaceFsNode) => void;
	onDelete: (node: SpaceFsNode) => void;
	onUpload?: (files: File[], targetDir: string) => void;
	isPinned?: (node: SpaceFsNode) => boolean;
	onTogglePin?: (node: SpaceFsNode) => void;
	onInsertReference?: (path: string) => void;
	draggable?: boolean;
	showItemActions?: boolean;
	canWrite?: boolean;
} = $props();

const indent = $derived(10 + depth * 14);
const isActive = $derived(selectedPath === node.path);
const isDir = $derived(node.type === "dir");
let isDragOver = $state(false);

function handleClick() {
	if (node.type === "dir") {
		onToggle(node);
	} else {
		onSelect(node);
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		handleClick();
	}
}

function stop(handler: () => void) {
	return (e: MouseEvent) => {
		e.stopPropagation();
		handler();
	};
}

function handleDragOver(e: DragEvent) {
	if (!isDir || !onUpload) return;
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
	isDragOver = true;
}

function handleDragLeave(e: DragEvent) {
	if (!isDir) return;
	// Only reset if we actually left the element (not entered a child)
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = e.clientX;
	const y = e.clientY;
	if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
		isDragOver = false;
	}
}

function handleDrop(e: DragEvent) {
	if (!isDir || !onUpload) return;
	e.preventDefault();
	e.stopPropagation();
	isDragOver = false;

	const files = e.dataTransfer?.files;
	if (!files?.length) return;

	// Only handle actual files, ignore internal drags
	if (!e.dataTransfer) return;
	if (e.dataTransfer.types.includes("text/cohub-path")) return;

	onUpload(Array.from(files), node.path);
}

function handleDirUploadClick() {
	if (!onUpload) return;
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.onchange = () => {
		if (input.files?.length) onUpload(Array.from(input.files), node.path);
	};
	input.click();
}
</script>

<div
  class:selected={isActive}
  data-space-file-path={node.path}
  class="tree-item"
  class:drop-target={isDragOver}
  role="button"
  tabindex="0"
  draggable={draggable}
  style={`padding-left: ${indent}px`}
  onclick={handleClick}
  onkeydown={handleKeydown}
  ondragstart={(e) => {
    if (!draggable) {
      e.preventDefault();
      return;
    }
    const path = node.type === "dir" ? `${node.path}/` : node.path;
    e.dataTransfer?.setData("text/cohub-path", path);
    e.dataTransfer?.setData("text/plain", path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  }}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <span class="icon shrink-0">
    {#if isDir}
      {#if node.isOpen}
        <FolderOpen class="w-3.5 h-3.5" />
      {:else}
        <Folder class="w-3.5 h-3.5" />
      {/if}
    {:else}
      <FileIcon class="w-3.5 h-3.5" />
    {/if}
  </span>
  <span class="name">{node.name}</span>
  {#if node.isLoading}
    <span class="loading">...</span>
  {/if}
  {#if showItemActions && node.type === "file" && onTogglePin}
    <span class="pin-action">
      {#if onInsertReference}
        <button type="button" class="action" title="Insert" onclick={stop(() => onInsertReference(node.path))}><FileIcon class="w-3 h-3" /></button>
      {/if}
      <button type="button" class="action" title={isPinned?.(node) ? "Unpin file" : "Pin file"} onclick={stop(() => onTogglePin(node))}>
        {#if isPinned?.(node)}
          <PinOff class="w-3 h-3" />
        {:else}
          <Pin class="w-3 h-3" />
        {/if}
      </button>
    </span>
  {/if}
  {#if showItemActions && canWrite}
    <span class="actions">
      {#if isDir}
        <button type="button" class="action" title="New file" onclick={stop(() => onCreateFile(node.path))}><Plus class="w-3 h-3" /></button>
        <button type="button" class="action" title="New folder" onclick={stop(() => onCreateDir(node.path))}><FolderPlus class="w-3 h-3" /></button>
        {#if onUpload}
          <button type="button" class="action" title="Upload here" onclick={stop(handleDirUploadClick)}><Upload class="w-3 h-3" /></button>
        {/if}
      {/if}
      <button type="button" class="action" title="Rename" onclick={stop(() => onRename(node))}><Pencil class="w-3 h-3" /></button>
      <button type="button" class="action danger" title="Delete" onclick={stop(() => onDelete(node))}><Trash2 class="w-3 h-3" /></button>
    </span>
  {/if}
</div>

{#if isDir && node.isOpen && depth < 50}
  {#each node.children as child (child.path)}
    <FsTreeItem
      node={child}
      depth={depth + 1}
      {selectedPath}
      {onToggle}
      {onSelect}
      {onCreateFile}
      {onCreateDir}
      {onRename}
      {onDelete}
      {onUpload}
      {isPinned}
      {onTogglePin}
      {onInsertReference}
      {draggable}
      {showItemActions}
      {canWrite}
    />
  {/each}
{/if}

<style>
  .tree-item {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
  }

  .tree-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tree-item.selected {
    background: var(--bg-active);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--brand-400) 55%, transparent);
    color: var(--text-primary);
  }

  .tree-item.selected .icon {
    color: var(--text-secondary);
  }

  .tree-item.drop-target {
    background: var(--bg-hover-strong);
    outline: 1px dashed var(--brand, #58a6ff);
    outline-offset: -1px;
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
  }

  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .loading {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .actions,
  .pin-action {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .tree-item:hover .actions,
  .tree-item.selected .actions,
  .tree-item:hover .pin-action,
  .tree-item.selected .pin-action {
    opacity: 1;
  }

  .action {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
  }

  .action:hover {
    background: var(--bg-hover-strong);
    color: var(--text-primary);
  }

  .action.danger:hover {
    color: var(--error-soft);
  }
</style>
