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
  if (role === "user") return "U";
  if (role === "assistant") return "A";
  return "S";
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
    current = current.parentMessageId
      ? nodeMap.get(current.parentMessageId)
      : undefined;
  }

  return ids;
});

const getDisplayDepth = (node: SessionTreeNodeView) =>
  displayDepthMap.get(node.id) ?? 0;

const isBranchChild = (node: SessionTreeNodeView) => {
  if (!node.parentMessageId) return false;
  const parent = nodeMap.get(node.parentMessageId);
  return (parent?.childCount ?? 0) > 1;
};
</script>

<div class="overflow-y-auto p-3 space-y-2 bg-gray-50/70 h-full">
  {#if nodes.length === 0}
    <div class="text-sm text-gray-400 px-2 py-3">No persisted tree nodes yet.</div>
  {:else}
    {#each nodes as node (node.id)}
      {@const displayDepth = getDisplayDepth(node)}
      {@const branchChild = isBranchChild(node)}
      {@const inCurrentPath = currentPathIds.has(node.id)}

      <div
        class="relative rounded-2xl border px-3 py-3 bg-white transition-all {node.id === currentLeafMessageId ? 'border-brand ring-2 ring-brand/20' : inCurrentPath ? 'border-brand/30 bg-brand/[0.03]' : 'border-gray-200'}"
        style={`margin-left: ${displayDepth * 18}px`}
      >
        {#if branchChild}
          <div class="absolute -left-4 top-4 flex items-center text-gray-300 pointer-events-none">
            <span class="text-lg leading-none">└</span>
          </div>
        {/if}

        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black {node.role === 'user' ? 'bg-brand text-white' : node.role === 'assistant' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-700'}">
                {roleLabel(node.role)}
              </span>
              {#if displayDepth > 0}
                <span class="text-[10px] uppercase tracking-[0.18em] font-black text-purple-500">
                  branch {displayDepth}
                </span>
              {/if}
              {#if node.childCount > 1}
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold">
                  {node.childCount} branches
                </span>
              {/if}
              {#if node.isCurrentLeaf}
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-bold">
                  current leaf
                </span>
              {/if}
            </div>

            <div class="text-sm text-gray-700 leading-6 line-clamp-3 break-words">
              {node.text || '(empty)'}
            </div>
          </div>

          <div class="shrink-0 flex flex-col gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
              onclick={() => onSelectLeaf(node.id)}
            >
              View path
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer {selectedBranchFromId === node.id ? 'bg-brand text-white' : 'border border-brand/20 text-brand hover:bg-brand/5'}"
              onclick={() => onBranchFrom(node.id)}
            >
              {selectedBranchFromId === node.id ? 'Branching here' : 'Branch from here'}
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
