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
    <div class="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-black/45">
      <span>{message.role}</span>
      {#if message.meta?.model && message.role === 'assistant'}
        <span>·</span>
        <span>{message.meta.model}</span>
      {/if}
    </div>

    <div class={`rounded-[1.25rem] border-[3px] px-4 py-3 text-[13px] leading-6 transition-colors duration-150 shadow-[4px_4px_0_0_#000] ${message.role === 'user' ? 'border-black bg-[#FFD93D] text-black' : message.role === 'assistant' ? 'border-black bg-white text-black/85' : message.role === 'system' ? 'border-black bg-[#4D96FF] text-black' : 'border-black bg-[#FF5A5F] text-white'}`}>
      {#if message.title}
        <div class="mb-2 text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{message.title}</div>
      {/if}
      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-inherit prose-code:text-inherit prose-neutral">
        {@html renderedHtml}
      </div>

      {#if message.blocks?.some((block) => block.type === 'tool_call')}
        <div class="mt-3 space-y-2 border-t-[3px] border-black pt-3">
          {#each message.blocks.filter((block) => block.type === 'tool_call') as block (block.toolCallId)}
            <div class="rounded-2xl border-[3px] border-black bg-[#FFF9F0] px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-3">
                <div class="text-[10px] font-black uppercase tracking-[0.16em] text-black/55">Tool</div>
                <div class={`text-[10px] font-black uppercase tracking-[0.16em] ${block.isError ? 'text-red-600' : 'text-black/55'}`}>
                  {block.isError ? 'error' : 'done'}
                </div>
              </div>
              <div class="text-[11px] font-bold text-black">{block.toolName}</div>
              {#if block.resultPreview}
                <pre class="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-black/65">{block.resultPreview}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-3 flex flex-wrap gap-3 border-t-[3px] border-black pt-3 text-[10px] font-black uppercase tracking-[0.14em] text-black/45">
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
