<script lang="ts">
import type { SessionTreeNodeView } from "$lib/session-tree";

type Props = {
  nodes: SessionTreeNodeView[];
  currentLeafMessageId?: string | null;
  selectedBranchFromId?: string | null;
  onSelectLeaf?: (messageId: string) => void;
  onBranchFrom?: (messageId: string) => void;
};

let {
  nodes,
  currentLeafMessageId = null,
  selectedBranchFromId = null,
  onSelectLeaf = () => {},
  onBranchFrom = () => {},
}: Props = $props();

const roleLabel = (role: SessionTreeNodeView["role"]) => {
  if (role === "user") return "u";
  if (role === "assistant") return "a";
  return "s";
};

const nodeMap = $derived(new Map(nodes.map((node) => [node.id, node])));

const displayDepthMap = $derived.by(() => {
  const map = new Map<string, number>();

  const resolveDepth = (node: SessionTreeNodeView): number => {
    const cached = map.get(node.id);
    if (cached !== undefined) return cached;

    if (!node.parentMessageId) {
      map.set(node.id, 0);
      return 0;
    }

    const parent = nodeMap.get(node.parentMessageId);
    if (!parent) {
      map.set(node.id, 0);
      return 0;
    }

    const parentDepth = resolveDepth(parent);
    const nextDepth = parent.childCount > 1 ? parentDepth + 1 : parentDepth;
    map.set(node.id, nextDepth);
    return nextDepth;
  };

  for (const node of nodes) {
    resolveDepth(node);
  }

  return map;
});

const currentPathIds = $derived.by(() => {
  const ids = new Set<string>();
  let current = currentLeafMessageId ? nodeMap.get(currentLeafMessageId) : undefined;

  while (current) {
    ids.add(current.id);
    current = current.parentMessageId ? nodeMap.get(current.parentMessageId) : undefined;
  }

  return ids;
});

const getDisplayDepth = (node: SessionTreeNodeView) => displayDepthMap.get(node.id) ?? 0;
const isBranchChild = (node: SessionTreeNodeView) => {
  if (!node.parentMessageId) return false;
  const parent = nodeMap.get(node.parentMessageId);
  return (parent?.childCount ?? 0) > 1;
};
</script>

<div class="h-full overflow-y-auto px-2 py-2">
  {#if nodes.length === 0}
    <div class="px-2 py-2 text-[10px] leading-[1.55] text-white/30">No persisted tree nodes yet.</div>
  {:else}
    <div class="space-y-0.5">
      {#each nodes as node (node.id)}
        {@const displayDepth = getDisplayDepth(node)}
        {@const branchChild = isBranchChild(node)}
        {@const inCurrentPath = currentPathIds.has(node.id)}

        <div
          class={`group relative rounded-md border px-2 py-1.5 transition-colors ${node.id === currentLeafMessageId ? 'border-white/10 bg-white/[0.05]' : inCurrentPath ? 'border-white/6 bg-white/[0.025]' : 'border-transparent bg-transparent hover:bg-white/[0.025]'}`}
          style={`margin-left: ${displayDepth * 14}px`}
        >
          {#if branchChild}
            <div class="pointer-events-none absolute -left-3 top-2 text-[10px] text-white/16">└</div>
          {/if}

          <div class="flex items-start gap-2">
            <div class="mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-white/[0.04] text-[8px] font-semibold uppercase tracking-[0.2em] text-white/34">
              {roleLabel(node.role)}
            </div>

            <div class="min-w-0 flex-1">
              <div class="truncate text-[10.5px] font-medium leading-[1.4] tracking-[-0.01em] text-white/64">
                {node.text || '(empty)'}
              </div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1 text-[8px] font-semibold uppercase tracking-[0.22em] text-white/20">
                {#if displayDepth > 0}
                  <span>branch {displayDepth}</span>
                {/if}
                {#if node.childCount > 1}
                  <span>{node.childCount} forks</span>
                {/if}
                {#if node.isCurrentLeaf}
                  <span>current</span>
                {/if}
              </div>
            </div>

            <div class="flex shrink-0 flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                class="rounded px-1.5 py-1 text-[8px] font-semibold uppercase tracking-[0.22em] text-white/28 transition-colors hover:bg-white/[0.04] hover:text-white/76 cursor-pointer"
                onclick={() => onSelectLeaf(node.id)}
              >
                path
              </button>
              <button
                type="button"
                class={`rounded px-1.5 py-1 text-[8px] font-semibold uppercase tracking-[0.22em] transition-colors cursor-pointer ${selectedBranchFromId === node.id ? 'bg-white/[0.07] text-white/82' : 'text-white/28 hover:bg-white/[0.04] hover:text-white/76'}`}
                onclick={() => onBranchFrom(node.id)}
              >
                {selectedBranchFromId === node.id ? 'branching' : 'branch'}
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
