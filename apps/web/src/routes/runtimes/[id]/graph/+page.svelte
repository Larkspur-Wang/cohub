<script lang="ts">
import type { RuntimeRecord, SessionRecord } from "$lib/api";

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

<svelte:head>
  <title>Session Graph · {data.runtime.title || data.runtime.id}</title>
</svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Session Graph</h1>
      <div class="mt-1 text-sm text-gray-500">Runtime: {data.runtime.title || data.runtime.id}</div>
    </div>
    <a href={`/runtimes/${data.runtime.id}`} class="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Back to Runtime</a>
  </div>

  <div class="rounded-2xl border border-gray-200 bg-white p-6">
    <div class="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Sessions</div>
    <div class="space-y-4">
      {#each data.sessions.filter((session) => !session.parentSessionId) as root, rootIndex (root.id)}
        <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div class="font-medium text-gray-900">{getSessionTitle(root, rootIndex)}</div>
          <div class="mt-1 text-xs text-gray-500 break-all">{root.id}</div>
          <div class="mt-2 text-xs text-gray-500">messages: {root.totalMessages ?? 0} · depth: {root.forkDepth ?? 0}</div>

          {#if (byParent.get(root.id)?.length ?? 0) > 0}
            <div class="mt-4 space-y-3 border-l-2 border-gray-200 pl-4">
              {#each byParent.get(root.id) ?? [] as child, childIndex (child.id)}
                <div class="rounded-lg border border-gray-200 bg-white p-3">
                  <div class="font-medium text-gray-900">{getSessionTitle(child, childIndex)}</div>
                  <div class="mt-1 text-xs text-gray-500 break-all">{child.id}</div>
                  <div class="mt-2 text-xs text-gray-500">forked from message: {data.messagePreviewById[child.forkedFromMessageId ?? ""] ?? child.forkedFromMessageId ?? "unknown"}</div>
                  <div class="mt-1 text-xs text-gray-500">messages: {child.totalMessages ?? 0} · depth: {child.forkDepth ?? 0}</div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
