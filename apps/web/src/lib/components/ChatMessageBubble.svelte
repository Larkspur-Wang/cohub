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
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-[46rem]' : 'max-w-[46rem]'}`}>
    <div class="mb-1.5 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-white/22">
      <span>{message.role}</span>
      {#if message.meta?.model && message.role === 'assistant'}
        <span>·</span>
        <span>{message.meta.model}</span>
      {/if}
    </div>

    <div class={`rounded-md border px-3 py-3 text-[12px] leading-6 transition-colors duration-150 ${message.role === 'user' ? 'border-white/6 bg-white/[0.04] text-white/88' : message.role === 'assistant' ? 'border-white/5 bg-[#171717] text-white/78' : message.role === 'system' ? 'border-blue-300/10 bg-blue-300/[0.035] text-blue-100/78' : 'border-red-300/10 bg-red-300/[0.035] text-red-100/78'}`}>
      {#if message.title}
        <div class="mb-2 text-[10px] uppercase tracking-[0.22em] opacity-56">{message.title}</div>
      {/if}
      <div class={`prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-inherit prose-code:text-inherit ${message.role === 'user' ? 'prose-invert' : 'prose-neutral dark:prose-invert'}`}>
        {@html renderedHtml}
      </div>

      {#if message.blocks?.some((block) => block.type === 'tool_call')}
        <div class="mt-3 space-y-2 border-t border-white/5 pt-3">
          {#each message.blocks.filter((block) => block.type === 'tool_call') as block (block.toolCallId)}
            <div class="rounded-md border border-white/5 bg-white/[0.022] px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-3">
                <div class="text-[10px] uppercase tracking-[0.2em] text-white/28">Tool</div>
                <div class={`text-[10px] uppercase tracking-[0.2em] ${block.isError ? 'text-red-300/78' : 'text-white/32'}`}>
                  {block.isError ? 'error' : 'done'}
                </div>
              </div>
              <div class="text-[11px] text-white/76">{block.toolName}</div>
              {#if block.resultPreview}
                <pre class="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-white/52">{block.resultPreview}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-3 flex flex-wrap gap-3 border-t border-white/5 pt-3 text-[10px] uppercase tracking-[0.16em] text-white/28">
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
