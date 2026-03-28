<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import ThinkingBlock from "$lib/components/ThinkingBlock.svelte";
import type { ChatMessage } from "$lib/session-tree";

type Props = {
  message: ChatMessage;
};

const { message }: Props = $props();
let renderedHtml = $state("");

$effect(() => {
  let cancelled = false;

  void renderMarkdown(message.text).then((html) => {
    if (!cancelled) {
      renderedHtml = html;
    }
  });

  return () => {
    cancelled = true;
  };
});
</script>

{#if message.role === 'system' && message.tone === 'thinking'}
  <ThinkingBlock title={message.title ?? 'Thinking'} content={message.text} isStreaming={message.id === 'assistant-thinking'} />
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-[52rem]' : 'max-w-[52rem]'}`}>
    <div class={`rounded-lg border px-4 py-3 text-[13px] leading-6 transition-colors duration-150 ${message.role === 'user' ? 'border-white/10 bg-white/5 text-white/90' : message.role === 'assistant' ? 'border-transparent bg-transparent text-white/80' : message.role === 'system' ? 'border-blue-500/20 bg-blue-500/5 text-blue-300/80' : 'border-rose-500/20 bg-rose-500/5 text-rose-300/80'}`}>
      {#if message.title}
        <div class="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">{message.title}</div>
      {/if}
      
      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-white prose-code:text-emerald-400 prose-invert text-inherit">
        {@html renderedHtml}
      </div>

      {#if message.blocks?.some((block) => block.type === 'tool_call')}
        <div class="mt-2.5 space-y-2 border-t border-white/5 pt-2.5">
          {#each message.blocks.filter((block) => block.type === 'tool_call') as block (block.toolCallId)}
            <div class="rounded-md border border-white/10 bg-black/40 px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-3">
                <div class="text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">Tool Call</div>
                <div class={`text-[10px] font-bold uppercase tracking-[0.16em] ${block.isError ? 'text-rose-400' : 'text-emerald-400/60'}`}>
                  {block.isError ? 'error' : 'done'}
                </div>
              </div>
              <div class="text-[11px] font-mono text-white/70">{block.toolName}</div>
              {#if block.resultPreview}
                <pre class="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-white/40 font-mono">{block.resultPreview}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/18">
          {#if message.meta.usageInput != null || message.meta.usageOutput != null}
            <span>in {message.meta.usageInput ?? 0} · out {message.meta.usageOutput ?? 0}</span>
          {/if}
          {#if message.meta.costTotal}
            <span>${message.meta.costTotal}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
