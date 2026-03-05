<script lang="ts">
  import type { TreeNode } from "$lib/types";

  import TreeItem from "./TreeItem.svelte";

  const {
    node,
    depth,
    selectedPath,
    onToggle,
    onSelect
  }: {
    node: TreeNode;
    depth: number;
    selectedPath: string;
    onToggle: (node: TreeNode) => void;
    onSelect: (node: TreeNode) => void;
  } = $props();

  const handleClick = () => {
    if (node.type === "dir") {
      onToggle(node);
      return;
    }

    onSelect(node);
  };

  const icon = $derived.by(() => {
    if (node.type === "dir") {
      return node.isOpen ? "▾" : "▸";
    }
    return "·";
  });

  const isActive = $derived(selectedPath === node.path);
</script>

<button
  class:active={isActive}
  class="tree-item"
  style={`padding-left: ${depth * 14 + 12}px`}
  onclick={handleClick}
  type="button"
>
  <span class="icon">{icon}</span>
  <span class="name">{node.name}</span>
  {#if node.isLoading}
    <span class="loading">...</span>
  {/if}
</button>

{#if node.type === "dir" && node.isOpen}
  {#each node.children as child (child.path)}
    <TreeItem
      node={child}
      depth={depth + 1}
      {selectedPath}
      {onToggle}
      {onSelect}
    />
  {/each}
{/if}

<style>
  .tree-item {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    display: flex;
    gap: 6px;
    align-items: center;
    padding-block: 6px;
    cursor: pointer;
  }

  .tree-item:hover {
    background: var(--panel-soft);
  }

  .tree-item.active {
    background: var(--accent-soft);
    color: #d9e1ff;
  }

  .icon {
    width: 10px;
    color: var(--text-soft);
  }

  .name {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .loading {
    margin-left: auto;
    color: var(--text-soft);
    font-size: 12px;
  }
</style>
