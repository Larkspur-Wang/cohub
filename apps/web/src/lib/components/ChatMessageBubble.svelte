<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import ThinkingBlock from "$lib/components/ThinkingBlock.svelte";
import type { ChatMessage } from "$lib/session-tree";

type Props = {
  message: ChatMessage;
};

const { message }: Props = $props();
let renderedHtml = $state("");
let thinkingExpanded = $state(true);

// Extract thinking blocks and text blocks separately
const thinkingContent = $derived(
  message.content
    ?.filter((block) => block.type === "thinking")
    .map((block) => (block.type === "thinking" ? block.thinking : ""))
    .join("\n\n")
    .trim() || ""
);

$effect(() => {
  let cancelled = false;

  void renderMarkdown(
    message.content
      ?.filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n\n") || message.text,
  ).then((html) => {
    if (!cancelled) {
      renderedHtml = html;
    }
  });

  return () => {
    cancelled = true;
  };
});
</script>

{#if message.role === 'system' && message.content?.some(b => b.type === 'thinking')}
  <ThinkingBlock title='Thinking' content={thinkingContent} isStreaming={message.id === 'assistant-thinking'} />
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-[90%] sm:max-w-[52rem]' : 'max-w-[90%] sm:max-w-[52rem]'}`}>
    <div class={`rounded-lg border px-4 py-3 text-[13px] leading-6 transition-colors duration-150 ${message.role === 'user' ? 'border-border-primary bg-hover-strong text-text-primary' : message.role === 'assistant' ? 'border-transparent bg-transparent text-text-secondary' : message.role === 'system' ? 'border-blue-500/20 bg-blue-500/5 text-blue-300/80' : 'border-rose-500/20 bg-rose-500/5 text-rose-300/80'}`}>

      {#if thinkingContent}
        <div class="mb-3 rounded-md border border-border-subtle bg-hover overflow-hidden">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-hover transition-colors"
            onclick={() => (thinkingExpanded = !thinkingExpanded)}
          >
            <div class="flex items-center gap-2">
              <div class="text-[10px] uppercase tracking-[0.16em] font-medium text-text-tertiary">Thinking</div>
              <div class="text-xs text-text-placeholder">{thinkingExpanded ? 'Hide' : 'Show'}</div>
            </div>
            <div class="text-text-tertiary text-xs">{thinkingExpanded ? '▾' : '▸'}</div>
          </button>
          {#if thinkingExpanded}
            <pre class="px-3 pb-3 whitespace-pre-wrap break-words text-[11px] leading-6 text-text-tertiary border-t border-border-subtle">{thinkingContent}</pre>
          {/if}
        </div>
      {/if}

      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-text-primary prose-code:text-emerald-400 prose-invert text-inherit">
        {@html renderedHtml}
      </div>

      {#if message.content?.some((block) => block.type === 'tool_use')}
        <div class="mt-2.5 space-y-2 border-t border-border-subtle pt-2.5">
          {#each message.content.filter((block) => block.type === 'tool_use') as block (block.id)}
            <div class="rounded-md border border-border-primary bg-bg-code px-3 py-2">
              <div class="mb-1 flex items-center justify-between gap-3">
                <div class="text-[10px] font-bold uppercase tracking-[0.16em] text-text-tertiary">Tool Call</div>
                <div class="text-[10px] font-bold uppercase tracking-[0.16em] text-text-tertiary">
                  {block.name}
                </div>
              </div>
              {#if block.input && Object.keys(block.input).length > 0}
                <pre class="mt-2 whitespace-pre-wrap break-words text-[11px] leading-5 text-text-tertiary font-mono">{JSON.stringify(block.input, null, 2)}</pre>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-text-placeholder">
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
