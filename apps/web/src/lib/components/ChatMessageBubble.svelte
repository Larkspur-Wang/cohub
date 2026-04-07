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

// Preview lines (first 3 lines)
const thinkingPreview = $derived(
	thinkingContent.split("\n").slice(0, 3).join("\n"),
);
const thinkingIsTruncated = $derived(thinkingContent.split("\n").length > 3);

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
	done: "border-l-success-soft",
	running: "border-l-warning-soft",
	error: "border-l-error-soft",
} as const;

const statusDotMap = {
	done: "bg-success-soft",
	running: "bg-warning-soft",
	error: "bg-error-soft",
} as const;
</script>

{#if message.role === 'system' && message.content?.some(b => b.type === 'thinking')}
  {#if thinkingContent}
    <div class="overflow-hidden">
      <div class="pl-3 border-l-2 border-l-amber-500/30">
        <pre class="text-[12px] leading-[1.6] text-amber-200/50 whitespace-pre-wrap break-words font-sans">{thinkingExpanded ? thinkingContent : thinkingPreview}{#if thinkingExpanded}
          {#if thinkingIsTruncated}
            <button
              type="button"
              class="inline ml-1 text-[11px] text-amber-200/30 hover:text-amber-200/50 cursor-pointer"
              onclick={() => thinkingExpanded = false}
            >Show less</button>{/if}
        {:else}
          {#if thinkingIsTruncated}<button
              type="button"
              class="inline ml-1 text-[11px] text-amber-200/30 hover:text-amber-200/50 cursor-pointer"
              onclick={() => thinkingExpanded = true}
            >… more</button>{/if}
        {/if}</pre>
        {#if isStreaming && !thinkingExpanded}
          <div class="mt-1 flex items-center gap-1.5 text-[10px] text-amber-200/30">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400/50 animate-pulse"></span>
            thinking
          </div>
        {/if}
      </div>
    </div>
  {/if}
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-[90%] sm:max-w-[52rem]' : 'max-w-[90%] sm:max-w-[52rem]'}`}>
    <div class={`rounded-xl px-3.5 py-2.5 text-[13px] leading-6 ${message.role === 'user' ? 'bg-brand/[0.06] text-text-primary rounded-br-md' : message.role === 'assistant' ? 'bg-bg-content/30 text-text-secondary rounded-bl-md' : message.role === 'system' ? 'bg-blue-500/5 text-blue-300/80' : 'bg-rose-500/5 text-rose-300/80'}`}>

      {#if thinkingContent}
        <div class="mb-2 pl-3 border-l-2 border-l-amber-500/20 overflow-hidden">
          <pre class="text-[12px] leading-[1.6] text-text-placeholder/70 whitespace-pre-wrap break-words font-sans">{thinkingExpanded ? thinkingContent : thinkingPreview}{#if thinkingExpanded}
            {#if thinkingIsTruncated}
              <button
                type="button"
                class="inline ml-1 text-[11px] text-text-placeholder/50 hover:text-text-tertiary cursor-pointer"
                onclick={() => { thinkingExpanded = false; thinkingUserToggled = true; }}
              >Show less</button>{/if}
          {:else}
            {#if thinkingIsTruncated}<button
                type="button"
                class="inline ml-1 text-[11px] text-text-placeholder/50 hover:text-text-tertiary cursor-pointer"
                onclick={() => { thinkingExpanded = true; thinkingUserToggled = true; }}
              >… more</button>{/if}
          {/if}</pre>
        </div>
      {/if}

      <div class="prose prose-sm max-w-none prose-pre:whitespace-pre-wrap prose-pre:break-words prose-code:before:content-none prose-code:after:content-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-headings:my-2 prose-strong:text-text-primary prose-code:text-emerald-400 prose-invert text-inherit">
        {@html renderedHtml}
      </div>

      {#if message.content?.some((block) => block.type === 'tool_use')}
        <div class="mt-1.5 space-y-0.5">
          {#each message.content.filter((block) => block.type === 'tool_use') as block (block.id)}
            {@const status = getToolStatus(block.id)}
            {@const result = findToolResult(block.id)}
            <div class="group rounded-md overflow-hidden">
              <!-- Collapsed row -->
              <button
                type="button"
                class="w-full flex items-center gap-2 pl-2 pr-2.5 py-1 text-left transition-colors hover:bg-hover/50 cursor-pointer border-l-2 {statusColorMap[status]}"
                onclick={() => toggleToolCall(block.id)}
              >
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDotMap[status]} {status === 'running' ? 'animate-pulse' : ''}"></span>
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
                <div class="pl-5">
                  {#if block.input && Object.keys(block.input).length > 0}
                    <div class="py-1.5">
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
                      <pre class="p-2 font-mono text-[12px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code rounded-md">{result.content}</pre>
                    {:else if Array.isArray(result.content)}
                      {#each result.content as contentBlock}
                        {#if contentBlock.type === 'text'}
                          <pre class="p-2 font-mono text-[12px] leading-5 text-text-secondary overflow-x-auto whitespace-pre-wrap break-words bg-bg-code rounded-md">{contentBlock.text}</pre>
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
        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-placeholder/60">
          {#if message.meta.usageInput != null || message.meta.usageOutput != null}
            <span>in {message.meta.usageInput ?? 0} · out {message.meta.usageOutput ?? 0}</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
