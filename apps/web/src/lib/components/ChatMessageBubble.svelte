<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import ThinkingBlock from "$lib/components/ThinkingBlock.svelte";
import type { ChatMessage } from "$lib/session-chat";

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
    </div>
  </div>
{/if}
