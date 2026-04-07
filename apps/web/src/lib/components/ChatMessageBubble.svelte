<script lang="ts">
import { renderMarkdown } from "$lib/markdown";
import type { ChatMessage } from "$lib/session-tree";
import type { ContentBlock } from "@cohub/protocol";
import { ChevronDown, ChevronRight } from "lucide-svelte";

type Props = {
	message: ChatMessage;
};

const { message }: Props = $props();
let renderedHtml = $state("");

// Thinking state: track user manual toggle to avoid overriding
let thinkingExpanded = $state(false);
let thinkingUserToggled = $state(false);

// Auto-expand during streaming, auto-collapse after (unless user toggled)
const isStreaming = $derived(
	message.id === "assistant-streaming" || message.id === "assistant-thinking",
);

$effect(() => {
	if (isStreaming && !thinkingUserToggled) {
		thinkingExpanded = true;
	} else if (!isStreaming && !thinkingUserToggled) {
		thinkingExpanded = false;
	}
});

// Extract thinking blocks and text blocks separately
const thinkingContent = $derived(
	message.content
		?.filter((block) => block.type === "thinking")
		.map((block) => (block.type === "thinking" ? block.thinking : ""))
		.join("\n\n")
		.trim() || "",
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

// Tool call inline helpers
function summarizeToolInput(
	name: string,
	input?: Record<string, unknown>,
): string {
	if (!input) return "";
	if (name === "bash" && typeof input.command === "string") {
		return `$ ${input.command}`;
	}
	if (
		["read", "write", "edit"].includes(name) &&
		typeof input.path === "string"
	) {
		return input.path;
	}
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

// Tool expansion state (per tool call id)
let expandedToolCalls = $state<Set<string>>(new Set());

function toggleToolCall(id: string) {
	const next = new Set(expandedToolCalls);
	if (next.has(id)) {
		next.delete(id);
	} else {
		next.add(id);
	}
	expandedToolCalls = next;
}

// Find matching tool_result for a tool_use
function findToolResult(toolUseId: string): ContentBlock | undefined {
	return message.content?.find(
		(block) => block.type === "tool_result" && block.tool_use_id === toolUseId,
	);
}

// Infer tool status from tool_result presence
function getToolStatus(toolUseId: string): "done" | "error" | "running" {
	const result = findToolResult(toolUseId);
	if (!result) return "running";
	if (result.type === "tool_result" && result.is_error) return "error";
	return "done";
}

const statusColorMap = {
	done: "text-success-soft",
	running: "text-warning-soft",
	error: "text-error-soft",
} as const;
</script>

{#if message.role === 'system' && message.content?.some(b => b.type === 'thinking')}
  {#if thinkingContent}
    <div class="rounded-md border border-amber-500/20 bg-amber-500/[0.06] overflow-hidden">
      <button
        type="button"
        class="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-amber-500/[0.08] transition-colors"
        onclick={() => { thinkingExpanded = !thinkingExpanded; thinkingUserToggled = true; }}
      >
        <div>
          <div class="text-[10px] uppercase tracking-[0.18em] font-medium text-amber-200/60">Thinking</div>
          <div class="mt-1 text-xs text-amber-100/80 flex items-center gap-2">
            <span>{thinkingExpanded ? 'Hide reasoning' : 'Show reasoning'}</span>
            {#if isStreaming}
              <span class="inline-flex items-center gap-1 text-[10px] text-amber-200/55">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                streaming
              </span>
            {/if}
          </div>
        </div>
        <div class="text-amber-200/60 text-xs">{thinkingExpanded ? '▾' : '▸'}</div>
      </button>
      {#if thinkingExpanded}
        <pre class="px-3 pb-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-amber-50/78 border-t border-amber-500/10">{thinkingContent}</pre>
      {/if}
    </div>
  {/if}
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-[90%] sm:max-w-[52rem]' : 'max-w-[90%] sm:max-w-[52rem]'}`}>
    <div class={`rounded-xl px-4 py-3 text-[13px] leading-6 ${message.role === 'user' ? 'bg-brand/[0.06] text-text-primary rounded-br-md' : message.role === 'assistant' ? 'bg-bg-content/30 text-text-secondary rounded-bl-md' : message.role === 'system' ? 'bg-blue-500/5 text-blue-300/80' : 'bg-rose-500/5 text-rose-300/80'}`}>

      {#if thinkingContent}
        <div class="mb-3 rounded-md border border-border-subtle bg-hover/50 overflow-hidden">
          <button
            type="button"
            class="w-full px-3 py-2 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-hover transition-colors"
            onclick={() => { thinkingExpanded = !thinkingExpanded; thinkingUserToggled = true; }}
          >
            <div class="flex items-center gap-2">
              <div class="text-[11px] font-medium text-text-tertiary">Thinking</div>
              <div class="text-xs text-text-placeholder">{thinkingExpanded ? 'Hide' : 'Show'}</div>
            </div>
            <div class="text-text-tertiary text-xs">{thinkingExpanded ? '▾' : '▸'}</div>
          </button>
          {#if thinkingExpanded}
            <pre class="px-3 pb-3 whitespace-pre-wrap break-words text-[12px] leading-6 text-text-tertiary border-t border-border-subtle">{thinkingContent}</pre>
          {/if}
        </div>
      {/if}

      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-text-primary prose-code:text-emerald-400 prose-invert text-inherit">
        {@html renderedHtml}
      </div>

      {#if message.content?.some((block) => block.type === 'tool_use')}
        <div class="mt-2.5 space-y-1">
          {#each message.content.filter((block) => block.type === 'tool_use') as block (block.id)}
            {@const status = getToolStatus(block.id)}
            {@const result = findToolResult(block.id)}
            <div class="group rounded-md overflow-hidden">
              <!-- Collapsed row -->
              <button
                type="button"
                class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-hover/50 cursor-pointer"
                onclick={() => toggleToolCall(block.id)}
              >
                <span class="text-[11px] font-medium {statusColorMap[status]}">{status}</span>
                <span class="text-[12px] font-mono text-text-tertiary">{block.name}</span>
                <span class="text-[12px] font-mono text-text-placeholder truncate">{summarizeToolInput(block.name, block.input)}</span>
                <span class="ml-auto text-text-tertiary shrink-0">
                  {#if expandedToolCalls.has(block.id)}
                    <ChevronDown class="w-3 h-3" />
                  {:else}
                    <ChevronRight class="w-3 h-3" />
                  {/if}
                </span>
              </button>

              <!-- Expanded content -->
              {#if expandedToolCalls.has(block.id)}
                <div class="border-t border-border-subtle/50">
                  {#if block.input && Object.keys(block.input).length > 0}
                    <div class="px-3 py-2 bg-hover/30">
                      {#if block.name === 'bash' && typeof block.input.command === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-text-secondary">$ {block.input.command}</pre>
                      {:else if ['read', 'write', 'edit'].includes(block.name) && typeof block.input.path === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-text-secondary">{block.input.path}</pre>
                      {:else}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-text-secondary">{JSON.stringify(block.input, null, 2)}</pre>
                      {/if}
                    </div>
                  {/if}
                  {#if result && result.type === 'tool_result'}
                    {#if typeof result.content === 'string'}
                      <pre class="p-3 font-mono text-[12px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code">{result.content}</pre>
                    {:else if Array.isArray(result.content)}
                      {#each result.content as contentBlock}
                        {#if contentBlock.type === 'text'}
                          <pre class="p-3 font-mono text-[12px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code">{contentBlock.text}</pre>
                        {/if}
                      {/each}
                    {/if}
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      {#if message.meta && message.role === 'assistant'}
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle/50 pt-2 text-[11px] font-medium text-text-placeholder">
          {#if message.meta.usageInput != null || message.meta.usageOutput != null}
            <span>in {message.meta.usageInput ?? 0} · out {message.meta.usageOutput ?? 0}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
