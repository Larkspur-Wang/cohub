<script lang="ts">
  type Props = {
    title?: string;
    content: string;
    isStreaming?: boolean;
  };

  let { title = 'Thinking', content, isStreaming = false }: Props = $props();
  let expanded = $state(false);
</script>

<div class="rounded-2xl border border-amber-100 bg-amber-50 text-amber-950 shadow-sm overflow-hidden">
  <button
    type="button"
    class="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-amber-100/60 transition-colors"
    onclick={() => (expanded = !expanded)}
  >
    <div>
      <div class="text-[10px] uppercase tracking-[0.2em] font-black opacity-70">{title}</div>
      <div class="mt-1 text-sm font-semibold flex items-center gap-2">
        <span>{expanded ? 'Hide reasoning' : 'Show reasoning'}</span>
        {#if isStreaming}
          <span class="inline-flex items-center gap-1 text-xs font-bold opacity-70">
            <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            streaming
          </span>
        {/if}
      </div>
    </div>

    <div class="text-amber-700 text-sm">{expanded ? '▾' : '▸'}</div>
  </button>

  {#if expanded}
    <pre class="px-4 pb-4 whitespace-pre-wrap break-words text-sm leading-6 font-inherit border-t border-amber-100">{content}</pre>
  {/if}
</div>
