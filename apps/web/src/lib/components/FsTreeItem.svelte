<script lang="ts">
import type { RuntimeFsNode } from "$lib/runtime-fs";
import { File, Folder, FolderOpen, Plus, FolderPlus, Pencil, Trash2 } from "lucide-svelte";
import FsTreeItem from "./FsTreeItem.svelte";

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
  node: RuntimeFsNode;
  depth: number;
  selectedPath: string;
  onToggle: (node: RuntimeFsNode) => void;
  onSelect: (node: RuntimeFsNode) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateDir: (parentPath: string) => void;
  onRename: (node: RuntimeFsNode) => void;
  onDelete: (node: RuntimeFsNode) => void;
  canWrite?: boolean;
} = $props();

const indent = $derived(10 + depth * 14);
const isActive = $derived(selectedPath === node.path);

function handleClick() {
  if (node.type === 'dir') {
    onToggle(node);
  } else {
    onSelect(node);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
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

{#if node.type === 'dir' && node.isOpen}
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
    text-align: left;
  }
  .tree-item:hover { background: var(--bg-hover); }
  .tree-item.selected { background: var(--bg-hover-strong); color: var(--text-primary); }
  .icon { color: var(--text-tertiary); }
  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .loading { font-size: 11px; color: var(--text-tertiary); }
  .actions {
    display: none;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .tree-item:hover .actions { display: inline-flex; }
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-tertiary);
  }
  .action:hover { background: var(--panel-soft); color: var(--text-primary); }
  .action.danger:hover { color: var(--error-soft); }
</style>
