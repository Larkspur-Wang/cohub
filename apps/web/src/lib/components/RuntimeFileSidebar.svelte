<script lang="ts">
import type { RuntimeFsNode } from "$lib/runtime-fs";
import { File, Folder, FolderOpen, RefreshCw, Plus, FolderPlus, Pencil, Trash2, AlertCircle } from "lucide-svelte";

const {
  nodes,
  selectedPath,
  loading,
  error,
  onToggle,
  onSelect,
  onRefresh,
  onCreateFile,
  onCreateDir,
  onRename,
  onDelete,
}: {
  nodes: RuntimeFsNode[];
  selectedPath: string;
  loading: boolean;
  error: string | null;
  onToggle: (node: RuntimeFsNode) => void;
  onSelect: (node: RuntimeFsNode) => void;
  onRefresh: () => void;
  onCreateFile: (parentPath: string) => void;
  onCreateDir: (parentPath: string) => void;
  onRename: (node: RuntimeFsNode) => void;
  onDelete: (node: RuntimeFsNode) => void;
} = $props();

function handleCreateFileAtRoot() {
  onCreateFile("");
}

function handleCreateDirAtRoot() {
  onCreateDir("");
}

function action(handler: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    handler();
  };
}
</script>

<div class="flex h-full flex-col bg-bg-primary min-w-0">
  <div class="flex items-center gap-1 border-b border-border-subtle px-3 py-2 shrink-0">
    <div class="min-w-0 flex-1">
      <div class="text-[11px] uppercase tracking-[0.14em] text-text-tertiary">Files</div>
      <div class="text-[12px] text-text-secondary">Runtime workspace</div>
    </div>
    <button class="icon-btn" type="button" title="New file" onclick={handleCreateFileAtRoot}>
      <Plus class="w-3.5 h-3.5" />
    </button>
    <button class="icon-btn" type="button" title="New folder" onclick={handleCreateDirAtRoot}>
      <FolderPlus class="w-3.5 h-3.5" />
    </button>
    <button class="icon-btn" type="button" title="Refresh" onclick={onRefresh}>
      <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
    </button>
  </div>

  {#if error}
    <div class="mx-3 mt-3 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-2 text-[12px] text-error-soft">
      <AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-auto px-2 py-2">
    {#if nodes.length === 0 && !loading}
      <div class="px-2 py-3 text-[12px] text-text-tertiary">No files</div>
    {:else}
      {#each nodes as node (node.path)}
        <div
          class:selected={selectedPath === node.path}
          class="tree-item"
          role="button"
          tabindex="0"
          style={`padding-left: 10px`}
          onclick={() => (node.type === 'dir' ? onToggle(node) : onSelect(node))}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); node.type === 'dir' ? onToggle(node) : onSelect(node); } }}
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
          <span class="actions">
            {#if node.type === 'dir'}
              <button type="button" class="action" title="New file" onclick={action(() => onCreateFile(node.path))}><Plus class="w-3 h-3" /></button>
              <button type="button" class="action" title="New folder" onclick={action(() => onCreateDir(node.path))}><FolderPlus class="w-3 h-3" /></button>
            {/if}
            <button type="button" class="action" title="Rename" onclick={action(() => onRename(node))}><Pencil class="w-3 h-3" /></button>
            <button type="button" class="action danger" title="Delete" onclick={action(() => onDelete(node))}><Trash2 class="w-3 h-3" /></button>
          </span>
        </div>

        {#if node.type === 'dir' && node.isOpen}
          {#each node.children as child (child.path)}
            <div
              class:selected={selectedPath === child.path}
              class="tree-item"
              role="button"
              tabindex="0"
              style={`padding-left: 24px`}
              onclick={() => (child.type === 'dir' ? onToggle(child) : onSelect(child))}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); child.type === 'dir' ? onToggle(child) : onSelect(child); } }}
            >
              <span class="icon shrink-0">
                {#if child.type === 'dir'}
                  {#if child.isOpen}
                    <FolderOpen class="w-3.5 h-3.5" />
                  {:else}
                    <Folder class="w-3.5 h-3.5" />
                  {/if}
                {:else}
                  <File class="w-3.5 h-3.5" />
                {/if}
              </span>
              <span class="name">{child.name}</span>
              {#if child.isLoading}
                <span class="loading">...</span>
              {/if}
              <span class="actions">
                {#if child.type === 'dir'}
                  <button type="button" class="action" title="New file" onclick={action(() => onCreateFile(child.path))}><Plus class="w-3 h-3" /></button>
                  <button type="button" class="action" title="New folder" onclick={action(() => onCreateDir(child.path))}><FolderPlus class="w-3 h-3" /></button>
                {/if}
                <button type="button" class="action" title="Rename" onclick={action(() => onRename(child))}><Pencil class="w-3 h-3" /></button>
                <button type="button" class="action danger" title="Delete" onclick={action(() => onDelete(child))}><Trash2 class="w-3 h-3" /></button>
              </span>
            </div>

            {#if child.type === 'dir' && child.isOpen}
              {#each child.children as grandchild (grandchild.path)}
                <div
                  class:selected={selectedPath === grandchild.path}
                  class="tree-item"
                  role="button"
                  tabindex="0"
                  style={`padding-left: 38px`}
                  onclick={() => (grandchild.type === 'dir' ? onToggle(grandchild) : onSelect(grandchild))}
                  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grandchild.type === 'dir' ? onToggle(grandchild) : onSelect(grandchild); } }}
                >
                  <span class="icon shrink-0">
                    {#if grandchild.type === 'dir'}
                      {#if grandchild.isOpen}
                        <FolderOpen class="w-3.5 h-3.5" />
                      {:else}
                        <Folder class="w-3.5 h-3.5" />
                      {/if}
                    {:else}
                      <File class="w-3.5 h-3.5" />
                    {/if}
                  </span>
                  <span class="name">{grandchild.name}</span>
                  <span class="actions">
                    {#if grandchild.type === 'dir'}
                      <button type="button" class="action" title="New file" onclick={action(() => onCreateFile(grandchild.path))}><Plus class="w-3 h-3" /></button>
                      <button type="button" class="action" title="New folder" onclick={action(() => onCreateDir(grandchild.path))}><FolderPlus class="w-3 h-3" /></button>
                    {/if}
                    <button type="button" class="action" title="Rename" onclick={action(() => onRename(grandchild))}><Pencil class="w-3 h-3" /></button>
                    <button type="button" class="action danger" title="Delete" onclick={action(() => onDelete(grandchild))}><Trash2 class="w-3 h-3" /></button>
                  </span>
                </div>
              {/each}
            {/if}
          {/each}
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-tertiary);
    background: transparent;
    border: none;
  }
  .icon-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
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
