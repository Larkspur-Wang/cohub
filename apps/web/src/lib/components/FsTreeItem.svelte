<script lang="ts">
import {
	Download,
	File as FileIcon,
	Folder,
	FolderOpen,
	MoreHorizontal,
	Pencil,
	Trash2,
	Upload,
} from "lucide-svelte";
import FsTreeItem from "$lib/components/FsTreeItem.svelte";
import { setCohubResourceDragData } from "$lib/drag/cohub-resource-drag";
import type { SpaceFsNode } from "$lib/space-fs";
import {
	entriesFromDataTransfer,
	entriesFromFiles,
	type LocalUploadEntry,
} from "$lib/upload-entries";

const {
	node,
	depth,
	selectedPath,
	onToggle,
	onSelect,
	onCreateFile,
	onCreateCanvas,
	onCreateDir,
	onRename,
	onDelete,
	onDownload,
	onUpload,
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
	onCreateCanvas?: (parentPath: string) => void;
	onCreateDir: (parentPath: string) => void;
	onRename: (node: SpaceFsNode) => void;
	onDelete: (node: SpaceFsNode) => void;
	onDownload?: (node: SpaceFsNode) => void;
	onUpload?: (files: File[] | LocalUploadEntry[], targetDir: string) => void;
	onInsertReference?: (path: string) => void;
	draggable?: boolean;
	showItemActions?: boolean;
	canWrite?: boolean;
} = $props();

const indent = $derived(10 + depth * 14);
const isActive = $derived(selectedPath === node.path);
const isDir = $derived(node.type === "dir");
let isDragOver = $state(false);

// Inline dropdown state
let menuOpen = $state(false);
let menuEl: HTMLDivElement | null = $state(null);

function openMenu() {
	menuOpen = true;
}

function closeMenu() {
	menuOpen = false;
}

function stop(handler: () => void) {
	return (e: MouseEvent) => {
		e.stopPropagation();
		handler();
	};
}

function stopAndCloseMenu(handler: () => void) {
	return (e: MouseEvent) => {
		e.stopPropagation();
		handler();
		menuOpen = false;
	};
}

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

function handleDragOver(e: DragEvent) {
	if (!isDir || !onUpload) return;
	e.preventDefault();
	e.stopPropagation();
	if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
	isDragOver = true;
}

function handleDragLeave(e: DragEvent) {
	if (!isDir) return;
	const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
	const x = e.clientX;
	const y = e.clientY;
	if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
		isDragOver = false;
	}
}

async function handleDrop(e: DragEvent) {
	if (!isDir || !onUpload) return;
	e.preventDefault();
	e.stopPropagation();
	isDragOver = false;
	if (!e.dataTransfer) return;
	if (e.dataTransfer.types.includes("text/cohub-path")) return;
	const entries = await entriesFromDataTransfer(e.dataTransfer);
	if (entries.length > 0) onUpload(entries, node.path);
}

function openUploadPicker(folder = false) {
	if (!onUpload) return;
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	if (folder) input.setAttribute("webkitdirectory", "");
	input.onchange = () => {
		if (input.files?.length)
			onUpload(entriesFromFiles(Array.from(input.files)), node.path);
	};
	input.click();
}

function handleUploadClick() {
	openUploadPicker(false);
}

function handleFolderUploadClick() {
	openUploadPicker(true);
}

// Close menu on outside click
$effect(() => {
	if (!menuOpen) return;
	function onClick(e: MouseEvent) {
		if (menuEl && !menuEl.contains(e.target as Node)) {
			menuOpen = false;
		}
	}
	document.addEventListener("click", onClick, true);
	return () => document.removeEventListener("click", onClick, true);
});
</script>

<div
  class:selected={isActive}
  data-space-file-path={node.path}
  class="tree-item"
  class:menu-open={menuOpen}
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
    if (node.type === "file") {
      setCohubResourceDragData(
        e.dataTransfer,
        {
          version: 1,
          resources: [{
            type: "file",
            ref: node.path,
            title: node.name,
            path: node.path,
          }],
          origin: { kind: "space-file-tree" },
          createdAt: Date.now(),
        },
        { cohubPath: path, plainText: path, effectAllowed: "copyMove" },
      );
      return;
    }
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

  {#if showItemActions && canWrite}
    <span class="actions">
      {#if onInsertReference}
        <button type="button" class="action" title="Insert" onclick={stop(() => onInsertReference(node.path))}><FileIcon class="w-3.5 h-3.5" /></button>
      {/if}
      <button type="button" class="action" title="Rename" onclick={stop(() => onRename(node))}><Pencil class="w-3.5 h-3.5" /></button>
      {#if isDir}
        {#if onUpload}
          <button type="button" class="action" title="Upload files" onclick={stop(handleUploadClick)}><Upload class="w-3.5 h-3.5" /></button>
        {/if}
        <span class="relative">
          <button type="button" class="action" title="More actions" onclick={stop(openMenu)}>
            <MoreHorizontal class="w-3.5 h-3.5" />
          </button>
          {#if menuOpen}
            <div class="dropdown" bind:this={menuEl}>
              {#if onUpload}
                <button type="button" class="dropdown-item" onclick={stopAndCloseMenu(handleFolderUploadClick)}><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M12 10V16"/><path d="m15 13-3-3-3 3"/></svg> Upload folder</button>
              {/if}
              <div class="dropdown-sep"></div>
              <button type="button" class="dropdown-item" onclick={stopAndCloseMenu(() => onCreateFile(node.path))}>New file</button>
              {#if onCreateCanvas}
                <button type="button" class="dropdown-item" onclick={stopAndCloseMenu(() => onCreateCanvas(node.path))}>New canvas</button>
              {/if}
              <button type="button" class="dropdown-item" onclick={stopAndCloseMenu(() => onCreateDir(node.path))}>New folder</button>
              <div class="dropdown-sep"></div>
              <button type="button" class="dropdown-item danger" onclick={stopAndCloseMenu(() => onDelete(node))}>Delete</button>
            </div>
          {/if}
        </span>
      {:else}
        <span class="relative">
          <button type="button" class="action" title="More actions" onclick={stop(openMenu)}>
            <MoreHorizontal class="w-3.5 h-3.5" />
          </button>
          {#if menuOpen}
            <div class="dropdown" bind:this={menuEl}>
              {#if onDownload}
                <button type="button" class="dropdown-item" onclick={stopAndCloseMenu(() => onDownload(node))}><Download class="w-3.5 h-3.5" /> Download</button>
                <div class="dropdown-sep"></div>
              {/if}
              <button type="button" class="dropdown-item danger" onclick={stopAndCloseMenu(() => onDelete(node))}><Trash2 class="w-3.5 h-3.5" /> Delete</button>
            </div>
          {/if}
        </span>
      {/if}
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
      {onCreateCanvas}
      {onCreateDir}
      {onRename}
      {onDelete}
      {onDownload}
      {onUpload}
      {onInsertReference}
      {draggable}
      {showItemActions}
      {canWrite}
    />
  {/each}
{/if}

<style>
  .tree-item {
    position: relative;
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
    color: var(--text-primary);
  }

  .tree-item.selected .icon {
    color: var(--text-secondary);
  }

  .tree-item.menu-open {
    z-index: 20;
  }

  .tree-item.drop-target {
    background: var(--bg-hover-strong);
    outline: 1px dashed var(--brand);
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

  .tree-item:hover:not(.menu-open) {
    z-index: 1;
  }

  .tree-item:hover,
  .tree-item:focus-within,
  .tree-item.selected {
    padding-right: 112px;
  }

  .actions {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  .tree-item:hover .actions,
  .tree-item:focus-within .actions,
  .tree-item.selected .actions {
    opacity: 1;
    pointer-events: auto;
  }

  .action {
    width: 24px;
    height: 24px;
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

  /* Inline dropdown */
  .relative { position: relative; }

  .dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 30;
    min-width: 150px;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  .dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .dropdown-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dropdown-item.danger:hover {
    color: var(--error-soft);
    background: var(--error-bg);
  }

  .dropdown-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border-subtle);
  }
</style>
