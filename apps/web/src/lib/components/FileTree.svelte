<script lang="ts">
import type { RepositoryTreeNode } from "$lib/types";

import TreeItem from "./TreeItem.svelte";

const {
  nodes,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: RepositoryTreeNode[];
  selectedPath: string;
  onToggle: (node: RepositoryTreeNode) => void;
  onSelect: (node: RepositoryTreeNode) => void;
} = $props();
</script>

<div class="file-tree">
  {#if nodes.length === 0}
    <p class="empty">No files</p>
  {:else}
    {#each nodes as node (node.path)}
      <TreeItem {node} depth={0} {selectedPath} {onToggle} {onSelect} />
    {/each}
  {/if}
</div>

<style>
  .file-tree {
    padding: 8px 0;
  }

  .empty {
    margin: 0;
    padding: 10px 14px;
    color: var(--text-soft);
    font-size: 13px;
  }
</style>
