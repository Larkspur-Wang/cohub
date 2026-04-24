<script lang="ts">
import {
	File,
	Folder,
	FolderOpen,
	FolderPlus,
	Pencil,
	Plus,
	Trash2,
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
	canWrite?: boolean;
} = $props();

const indent = $derived(10 + depth * 14);
const isActive = $derived(selectedPath === node.path);

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
</script>

<div
  class:selected={isActive}
  class="tree-item"
  role="button"
  tabindex="0"
  style={`padding-left: ${indent}px`}
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <span class="icon shrink-0">
    {#if node.type === 'dir'}
      {#if node.isOpen}
        <FolderOpen class="w-3.5 h-3.5" />
      {:else}
        <Folder class="w-3.5 h-3.5" />
      {/if}
    {:else}
      <File class="w-3.5 h-3.5" />
    {/if}
  </span>
  <span class="name">{node.name}</span>
  {#if node.isLoading}
    <span class="loading">...</span>
  {/if}
  {#if canWrite}
    <span class="actions">
      {#if node.type === 'dir'}
        <button type="button" class="action" title="New file" onclick={stop(() => onCreateFile(node.path))}><Plus class="w-3 h-3" /></button>
        <button type="button" class="action" title="New folder" onclick={stop(() => onCreateDir(node.path))}><FolderPlus class="w-3 h-3" /></button>
      {/if}
      <button type="button" class="action" title="Rename" onclick={stop(() => onRename(node))}><Pencil class="w-3 h-3" /></button>
      <button type="button" class="action danger" title="Delete" onclick={stop(() => onDelete(node))}><Trash2 class="w-3 h-3" /></button>
    </span>
  {/if}
</div>

{#if node.type === 'dir' && node.isOpen && depth < 50}
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
    background: var(--bg-hover-strong);
    color: var(--text-primary);
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

  .actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .tree-item:hover .actions,
  .tree-item.selected .actions {
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
