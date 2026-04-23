<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import { ChevronDown, ChevronRight } from "lucide-svelte";
import { mediaLightbox } from "$lib/components/media-lightbox.svelte";
import { renderMarkdown } from "$lib/markdown";
import type { ChatMessage } from "$lib/session-tree";

type Props = {
	message: ChatMessage;
};

type ImageBlock = Extract<ContentBlock, { type: "image" }>;

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
		.replace(/\n{3,}/g, "\n\n")
		.trim() || "",
);

const imageBlocks = $derived(
	(message.content?.filter(
		(block) => block.type === "image",
	) as ImageBlock[]) ?? [],
);

function getImagePreviewSrc(block: ImageBlock): string {
	if (block.source.type === "url") return block.source.url;
	return `data:${block.source.media_type};base64,${block.source.data}`;
}

function getImageAlt(block: ImageBlock, index: number): string {
	return String(block._meta?.filename ?? `attachment-${index + 1}`);
}

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

const textContent = $derived(
	message.content
		?.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n\n")
		.trim() || "",
);

$effect(() => {
	let cancelled = false;

	const markdownSource =
		textContent || (message.content?.length ? "" : message.text);

	void renderMarkdown(markdownSource).then((html) => {
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
function getToolStatus(toolUseId: string): "done" | "failed" | "running" {
	const result = findToolResult(toolUseId);
	if (!result) return "running";
	if (result.type === "tool_result" && result.is_error) return "failed";
	return "done";
}

const statusDotMap = {
	done: "bg-status-running",
	running: "bg-status-starting",
	failed: "bg-status-error",
} as const;

// ─── Markdown container ref for media event delegation ───
let markdownEl = $state<HTMLElement | null>(null);

$effect(() => {
	const el = markdownEl;
	if (!el) return;

	function onClick(e: Event) {
		const target = e.target as HTMLElement;
		if (target.tagName === "IMG") {
			e.preventDefault();
			e.stopPropagation();
			const img = target as HTMLImageElement;
			mediaLightbox.show({
				src: img.src,
				type: "image" as const,
				alt: img.alt,
			});
		} else if (
			target.tagName === "VIDEO" ||
			(target.tagName === "SOURCE" && target.parentElement?.tagName === "VIDEO")
		) {
			e.preventDefault();
			e.stopPropagation();
			const video =
				target.tagName === "VIDEO"
					? (target as HTMLVideoElement)
					: (target.parentElement as HTMLVideoElement);
			mediaLightbox.show({
				src: video.src || (video.querySelector("source")?.src ?? ""),
				type: "video" as const,
			});
		}
	}

	el.addEventListener("click", onClick);
	return () => el.removeEventListener("click", onClick);
});
</script>

{#if message.role === 'system' && message.content?.some(b => b.type === 'thinking')}
  {#if thinkingContent}
    <div>
      <div class="text-[13px] leading-snug text-text-disabled break-words font-sans whitespace-pre-wrap">
        {getThinkingDisplay(thinkingExpanded)}
        {#if isStreaming}
          <div class="mt-1 inline-flex items-center gap-1.5 text-[11px] text-text-placeholder">
            <span class="w-1.5 h-1.5 rounded-full bg-status-starting animate-pulse"></span>
            thinking
          </div>
        {/if}
      </div>
      {#if !isStreaming && thinkingNeedsTruncation}
        <button
          type="button"
          class="mt-1 text-[11px] text-text-placeholder hover:text-text-tertiary cursor-pointer"
          onclick={() => thinkingExpanded = !thinkingExpanded}
        >
          {thinkingExpanded ? 'Show less' : '… more'}
        </button>
      {/if}
    </div>
  {/if}
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-full sm:max-w-[52rem]' : 'max-w-full sm:max-w-[52rem]'}`}>
    {#if message.role === 'user' && message.authorName}
      <div class="flex items-center gap-2 mb-1 justify-end">
        <span class="text-[12px] text-text-tertiary font-medium">{message.authorName}</span>
        {#if message.authorAvatar}
          <img src={message.authorAvatar} alt="" class="w-5 h-5 rounded-full shrink-0" />
        {:else}
          <span class="w-5 h-5 rounded-full bg-brand/20 flex items-center justify-center text-[10px] text-brand font-semibold shrink-0">
            {message.authorName.charAt(0).toUpperCase()}
          </span>
        {/if}
      </div>
    {/if}
    <div class={`px-2 py-2 text-[14px] leading-[1.7] ${message.role === 'user' ? 'bg-brand/5 text-text-primary rounded-xl rounded-br-md' : message.role === 'assistant' ? 'text-text-primary' : message.role === 'system' ? 'bg-info-bg text-info-soft' : 'bg-error-bg text-error-soft'}`}>

      {#if thinkingContent}
        <div class="mb-3">
          <div class="text-[13px] leading-snug text-text-disabled break-words font-sans whitespace-pre-wrap">
            {getThinkingDisplay(thinkingExpanded)}
          </div>
          {#if thinkingNeedsTruncation}
            <button
              type="button"
              class="mt-1 text-[11px] text-text-placeholder hover:text-text-tertiary cursor-pointer"
              onclick={() => { thinkingExpanded = !thinkingExpanded; thinkingUserToggled = true; }}
            >
              {thinkingExpanded ? 'Show less' : '… more'}
            </button>
          {/if}
        </div>
      {/if}

      {#if imageBlocks.length > 0}
        <div class="mb-3 grid grid-cols-2 gap-2 max-w-md">
          {#each imageBlocks as block, index}
            <button
              type="button"
              class="group overflow-hidden rounded-2xl border border-border-subtle bg-bg-content p-0 cursor-zoom-in"
              onclick={() => {
                const gallery = imageBlocks.map((b, i) => ({
                  src: getImagePreviewSrc(b),
                  type: "image" as const,
                  alt: getImageAlt(b, i),
                }));
                mediaLightbox.show(gallery, index);
              }}
            >
              <img src={getImagePreviewSrc(block)} alt={getImageAlt(block, index)} class="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" />
            </button>
          {/each}
        </div>
      {/if}

      <div
        bind:this={markdownEl}
        class="prose prose-sm prose-invert max-w-none text-inherit"
      >
        {@html renderedHtml}
      </div>

      {#if message.content?.some((block) => block.type === 'tool_use')}
        <div class="mt-4">
          {#each message.content.filter((block) => block.type === 'tool_use') as block (block.id)}
            {@const status = getToolStatus(block.id)}
            {@const result = findToolResult(block.id)}
            <div class="group rounded-md overflow-hidden">
              <!-- Collapsed row -->
              <button
                type="button"
                class="w-full flex items-center gap-2 pl-0 pr-4 py-0.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer"
                onclick={() => toggleToolCall(block.id)}
              >
                <span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 align-middle {statusDotMap[status]} {status === 'running' ? 'animate-pulse' : ''}"></span>
                <span class="text-[13px] font-mono text-text-tertiary shrink-0 w-[3em]">{block.name}</span>
                <span class="min-w-0 text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(block.name, block.input)}</span>
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
                <div class="pl-[26px] pr-4">
                  {#if block.input && Object.keys(block.input).length > 0}
                    <div class="py-1.5">
                      {#if block.name === 'bash' && typeof block.input.command === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">$ {block.input.command}</pre>
                      {:else if ['read', 'write', 'edit'].includes(block.name) && typeof block.input.path === 'string'}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">{block.input.path}</pre>
                      {:else}
                        <pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">{JSON.stringify(block.input, null, 2)}</pre>
                      {/if}
                    </div>
                  {/if}
                  {#if result && result.type === 'tool_result'}
                    {#if typeof result.content === 'string'}
                      <pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{result.content}</pre>
                    {:else if Array.isArray(result.content)}
                      {#each result.content as contentBlock}
                        {#if contentBlock.type === 'text'}
                          <pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{contentBlock.text}</pre>
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

      {#if message.meta?.model}
        <div class="mt-2 text-[10px] text-text-placeholder/30">
          {message.meta.provider}/{message.meta.model}
        </div>
      {/if}

    </div>
  </div>
{/if}
