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
</script>

<div class="overflow-y-auto p-3 space-y-2 bg-gray-50/70 h-full">
  {#if nodes.length === 0}
    <div class="text-sm text-gray-400 px-2 py-3">No persisted tree nodes yet.</div>
  {:else}
    {#each nodes as node (node.id)}
      <div
        class="rounded-2xl border px-3 py-3 bg-white transition-all {node.id === currentLeafMessageId ? 'border-brand ring-2 ring-brand/20' : 'border-gray-200'}"
        style={`margin-left: ${node.depth * 14}px`}
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black {node.role === 'user' ? 'bg-brand text-white' : node.role === 'assistant' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-700'}">
                {roleLabel(node.role)}
              </span>
              <span class="text-[10px] uppercase tracking-[0.18em] font-black text-gray-400">
                depth {node.depth}
              </span>
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
