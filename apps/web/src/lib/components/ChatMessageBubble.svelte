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

// Thinking truncation: JS-based since line-clamp conflicts with whitespace-pre-wrap
const THINKING_COLLAPSE_CHARS = 260;
const thinkingNeedsTruncation = $derived(
	thinkingContent.length > THINKING_COLLAPSE_CHARS,
);
function getThinkingDisplay(expanded: boolean): string {
	if (expanded || !thinkingNeedsTruncation) return thinkingContent;
	const truncated = thinkingContent.slice(0, THINKING_COLLAPSE_CHARS);
	// Prefer cutting at last newline for cleaner truncation
	const lastNewline = truncated.lastIndexOf("\n");
	return lastNewline > THINKING_COLLAPSE_CHARS * 0.5
		? truncated.slice(0, lastNewline)
		: `${truncated}…`;
}

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

const statusDotMap = {
	done: "bg-emerald-400",
	running: "bg-amber-400",
	error: "bg-rose-400",
} as const;
</script>

{#if message.role === 'system' && message.content?.some(b => b.type === 'thinking')}
  {#if thinkingContent}
    <div>
      <div class="text-[13px] leading-[1.7] text-amber-200/50 break-words font-sans whitespace-pre-wrap">
        {getThinkingDisplay(thinkingExpanded)}
        {#if isStreaming}
          <div class="mt-1 inline-flex items-center gap-1.5 text-[11px] text-amber-200/30">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400/50 animate-pulse"></span>
            thinking
          </div>
        {/if}
      </div>
      {#if !isStreaming && thinkingNeedsTruncation}
        <button
          type="button"
          class="mt-1 text-[11px] text-amber-200/30 hover:text-amber-200/50 cursor-pointer"
          onclick={() => thinkingExpanded = !thinkingExpanded}
        >
          {thinkingExpanded ? 'Show less' : '… more'}
        </button>
      {/if}
    </div>
  {/if}
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-full sm:max-w-[52rem]' : 'max-w-full sm:max-w-[52rem]'}`}>
    <div class={`px-4 py-3 text-[14px] leading-[1.7] ${message.role === 'user' ? 'bg-brand/[0.06] text-text-primary rounded-xl rounded-br-md' : message.role === 'assistant' ? 'text-text-primary' : message.role === 'system' ? 'bg-blue-500/5 text-blue-300/80' : 'bg-rose-500/5 text-rose-300/80'}`}>

      {#if thinkingContent}
        <div class="mb-3">
          <div class="text-[13px] leading-[1.7] text-text-placeholder/70 break-words font-sans whitespace-pre-wrap">
            {getThinkingDisplay(thinkingExpanded)}
          </div>
          {#if thinkingNeedsTruncation}
            <button
              type="button"
              class="mt-1 text-[11px] text-text-placeholder/50 hover:text-text-tertiary cursor-pointer"
              onclick={() => { thinkingExpanded = !thinkingExpanded; thinkingUserToggled = true; }}
            >
              {thinkingExpanded ? 'Show less' : '… more'}
            </button>
          {/if}
        </div>
      {/if}

      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-text-primary prose-code:text-emerald-400 prose-invert text-inherit">
        {@html renderedHtml}
      </div>

      {#if message.content?.some((block) => block.type === 'tool_use')}
        <div class="mt-2 space-y-1">
          {#each message.content.filter((block) => block.type === 'tool_use') as block (block.id)}
            {@const status = getToolStatus(block.id)}
            {@const result = findToolResult(block.id)}
            <div class="group rounded-md overflow-hidden">
              <!-- Collapsed row -->
              <button
                type="button"
                class="w-full flex items-center gap-2 pl-0 pr-4 py-1.5 text-left transition-colors hover:bg-hover/50 cursor-pointer"
                onclick={() => toggleToolCall(block.id)}
              >
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDotMap[status]} {status === 'running' ? 'animate-pulse' : ''}"></span>
                <span class="text-[13px] font-mono text-text-tertiary">{block.name}</span>
                <span class="text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(block.name, block.input)}</span>
                <span class="ml-auto text-text-tertiary shrink-0">
                  {#if expandedToolCalls.has(block.id)}
                    <ChevronDown class="w-3.5 h-3.5" />
                  {:else}
                    <ChevronRight class="w-3.5 h-3.5" />
                  {/if}
                </span>
              </button>

              <!-- Expanded content -->
              {#if expandedToolCalls.has(block.id)}
                <div class="pl-7 pr-4">
                  {#if block.input && Object.keys(block.input).length > 0}
                    <div class="py-1.5">
                      {#if block.name === 'bash' && typeof block.input.command === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-text-secondary">$ {block.input.command}</pre>
                      {:else if ['read', 'write', 'edit'].includes(block.name) && typeof block.input.path === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-text-secondary">{block.input.path}</pre>
                      {:else}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-text-secondary">{JSON.stringify(block.input, null, 2)}</pre>
                      {/if}
                    </div>
                  {/if}
                  {#if result && result.type === 'tool_result'}
                    {#if typeof result.content === 'string'}
                      <pre class="p-2 font-mono text-[13px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code rounded-md">{result.content}</pre>
                    {:else if Array.isArray(result.content)}
                      {#each result.content as contentBlock}
                        {#if contentBlock.type === 'text'}
                          <pre class="p-2 font-mono text-[13px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code rounded-md">{contentBlock.text}</pre>
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
        <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-text-placeholder/60">
          {#if message.meta.usageInput != null || message.meta.usageOutput != null}
            <span>in {message.meta.usageInput ?? 0} · out {message.meta.usageOutput ?? 0}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
