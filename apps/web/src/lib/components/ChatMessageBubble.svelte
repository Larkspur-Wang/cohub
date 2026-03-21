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
  <div class="max-w-[90%] {message.role === 'user' ? 'ml-auto' : ''}">
    <div class="rounded-2xl px-4 py-3 border text-sm leading-6 shadow-sm
      {message.role === 'user' ? 'bg-brand text-white border-brand' : ''}
      {message.role === 'assistant' ? 'bg-white text-gray-800 border-gray-200' : ''}
      {message.role === 'system' ? 'bg-blue-50 text-blue-800 border-blue-100' : ''}
      {message.role === 'error' ? 'bg-red-50 text-red-800 border-red-100' : ''}
    ">
      {#if message.title}
        <div class="text-[10px] uppercase tracking-[0.2em] font-black mb-2 opacity-70">{message.title}</div>
      {/if}
      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 {message.role === 'user' ? 'prose-invert' : ''}">
        {@html renderedHtml}
      </div>

      {#if message.blocks?.some((block) => block.type === 'tool_call')}
        <div class="mt-4 space-y-2">
          {#each message.blocks.filter((block) => block.type === 'tool_call') as block (block.toolCallId)}
            <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div class="flex items-center justify-between gap-3 mb-1">
                <div class="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Tool</div>
                <div class="text-xs font-bold {block.isError ? 'text-red-600' : 'text-slate-500'}">
                  {block.isError ? 'error' : 'done'}
                </div>
              </div>
              <div class="font-semibold text-slate-800">{block.toolName}</div>
              {#if block.resultPreview}
                <pre class="mt-2 text-xs leading-5 whitespace-pre-wrap break-words text-slate-700">{block.resultPreview}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-3 text-[11px] text-gray-400 font-medium">
          {#if message.meta.model}
            <span>{message.meta.model}</span>
          {/if}
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
