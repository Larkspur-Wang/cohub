<script lang="ts">
type Props = {
  title?: string;
  content: string;
  isStreaming?: boolean;
};

const { title = "Thinking", content, isStreaming = false }: Props = $props();
let expanded = $state(false);
</script>

<div class="rounded-md border border-amber-500/20 bg-amber-500/[0.06] overflow-hidden">
  <button
    type="button"
    class="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-amber-500/[0.08] transition-colors"
    onclick={() => (expanded = !expanded)}
  >
    <div>
      <div class="text-[10px] uppercase tracking-[0.18em] font-medium text-amber-200/60">{title}</div>
      <div class="mt-1 text-xs text-amber-100/80 flex items-center gap-2">
        <span>{expanded ? 'Hide reasoning' : 'Show reasoning'}</span>
        {#if isStreaming}
          <span class="inline-flex items-center gap-1 text-[10px] text-amber-200/55">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            streaming
          </span>
        {/if}
      </div>
    </div>

    <div class="text-amber-200/60 text-xs">{expanded ? '▾' : '▸'}</div>
  </button>

  {#if expanded}
    <pre class="px-3 pb-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-amber-50/78 border-t border-amber-500/10">{content}</pre>
  {/if}
</div>
