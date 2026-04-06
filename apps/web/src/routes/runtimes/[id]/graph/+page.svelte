<script lang="ts">
import type { RuntimeRecord, SessionRecord } from "$lib/api";
import { goto } from "$app/navigation";
import { ArrowLeft } from "lucide-svelte";

type Props = {
  data: {
    runtime: RuntimeRecord;
    sessions: SessionRecord[];
    messagePreviewById: Record<string, string>;
  };
};

const { data }: Props = $props();

const byParent = $derived.by(() => {
  const map = new Map<string | null, SessionRecord[]>();
  for (const session of data.sessions) {
    const key = session.parentSessionId ?? null;
    const list = map.get(key) ?? [];
    list.push(session);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  return map;
});

function getSessionTitle(session: SessionRecord, index: number) {
  return session.title?.trim() || session.latestMessageText?.trim() || `Session ${index + 1}`;
}
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <!-- Header -->
  <div class="h-10 flex items-center justify-between px-4 border-b border-white/10 shrink-0 bg-[#0A0A0A]">
    <div class="flex items-center gap-3 min-w-0">
      <button class="text-white/40 hover:text-white transition-colors shrink-0" onclick={() => goto(`/runtimes/${data.runtime.id}`)}>
        <ArrowLeft class="w-4 h-4" />
      </button>
      <div class="w-[1px] h-4 bg-white/10 shrink-0"></div>
      <span class="text-xs font-medium text-white/60">Session Graph</span>
      <span class="text-[10px] text-white/25 truncate font-mono">{data.runtime.title || data.runtime.id}</span>
    </div>
  </div>

  <div class="flex-1 p-4 overflow-y-auto">
    <div class="space-y-3">
      {#each data.sessions.filter((session) => !session.parentSessionId) as root, rootIndex (root.id)}
        <div class="rounded-lg border border-white/10 bg-[#121212] p-4">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></div>
            <span class="text-sm font-medium text-white/80">{getSessionTitle(root, rootIndex)}</span>
          </div>
          <div class="text-[10px] text-white/25 font-mono ml-3.5">{root.id}</div>
          <div class="text-[10px] text-white/25 ml-3.5 mt-1">depth: {root.forkDepth ?? 0}</div>

          {#if (byParent.get(root.id)?.length ?? 0) > 0}
            <div class="mt-3 ml-3 space-y-2 border-l border-white/10 pl-4">
              {#each byParent.get(root.id) ?? [] as child, childIndex (child.id)}
                <div class="rounded-md border border-white/5 bg-black/20 p-3">
                  <div class="flex items-center gap-2 mb-1">
                    <div class="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></div>
                    <span class="text-xs text-white/70">{getSessionTitle(child, childIndex)}</span>
                  </div>
                  <div class="text-[10px] text-white/25 font-mono ml-3.5">{child.id}</div>
                  <div class="text-[10px] text-white/25 ml-3.5 mt-1">
                    forked from: {data.messagePreviewById[child.forkedFromMessageId ?? ""] ?? child.forkedFromMessageId ?? "unknown"}
                  </div>
                  <div class="text-[10px] text-white/25 ml-3.5">depth: {child.forkDepth ?? 0}</div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
