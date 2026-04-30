<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { Check, Copy } from "lucide-svelte";
import { tick } from "svelte";
import { mediaLightbox } from "$lib/components/media-lightbox.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import { renderMarkdown } from "$lib/markdown";
import type { ChatMessage } from "$lib/session-tree";

type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

type Props = {
	message: ChatMessage;
	modelsCatalog?: ModelCatalogItem[];
	onMarkdownRenderStart?: (message: ChatMessage) => void;
	onMarkdownRendered?: (message: ChatMessage) => void;
};

type ImageBlock = Extract<ContentBlock, { type: "image" }>;

const {
	message,
	modelsCatalog,
	onMarkdownRenderStart,
	onMarkdownRendered,
}: Props = $props();
let renderedHtml = $state("");

// Thinking state: track user manual toggle to avoid overriding
let thinkingExpanded = $state(false);
let thinkingUserToggled = $state(false);
// Auto-expand during streaming, auto-collapse after (unless user toggled)
const isStreaming = $derived(
	message.meta?.messageKind === "assistant_streaming_preview" ||
		message.id.startsWith("assistant-streaming:") ||
		message.id === "assistant-streaming" ||
		message.id === "assistant-thinking",
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
	thinkingContent.length > THINKING_COLLAPSE_CHARS ||
		(message.content?.some(
			(block) => block.type === "thinking" && block._meta?.truncated === true,
		) ??
			false),
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

const assistantErrorMessage = $derived(
	message.role === "assistant" &&
		(message.meta?.messageKind === "assistant_error" ||
			message.meta?.stopReason === "error" ||
			message.meta?.stopReason === "aborted")
		? (message.meta?.errorMessage ??
				(message.meta?.stopReason === "aborted"
					? "Operation aborted"
					: "Unknown error"))
		: "",
);

const isUserMessage = $derived(message.role === "user");

$effect(() => {
	if (isUserMessage) {
		renderedHtml = "";
		return;
	}
	let cancelled = false;

	const markdownSource =
		textContent || (message.content?.length ? "" : message.text);

	let settled = false;
	const settleMarkdownRender = () => {
		if (settled) return;
		settled = true;
		onMarkdownRendered?.(message);
	};
	onMarkdownRenderStart?.(message);
	void renderMarkdown(markdownSource)
		.then(async (html) => {
			if (cancelled) {
				settleMarkdownRender();
				return;
			}
			renderedHtml = html;
			await tick();
			requestAnimationFrame(settleMarkdownRender);
		})
		.catch(settleMarkdownRender);

	return () => {
		cancelled = true;
		settleMarkdownRender();
	};
});

function toggleThinking() {
	thinkingExpanded = !thinkingExpanded;
	thinkingUserToggled = true;
}

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

// ─── Meta bar: time, model, tokens, copy ───

// Time display
const shortTime = $derived(
	message.createdAt
		? new Date(message.createdAt).toLocaleTimeString("en-GB", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			})
		: "",
);

const fullDateTime = $derived(
	message.createdAt
		? new Date(message.createdAt).toLocaleString("en-GB", {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			})
		: "",
);

// Model display: default show model name (matched from catalog), fallback to model id
const modelMatch = $derived.by(() => {
	if (!message.meta?.provider || !message.meta?.model) return null;
	return modelsCatalog?.find(
		(m) =>
			m.provider === message.meta?.provider && m.id === message.meta?.model,
	);
});

const modelName = $derived(
	(modelMatch?.model?.name as string | undefined) ?? message.meta?.model ?? "",
);

const modelDisplayName = $derived(message.meta?.model ? modelName : "");

const modelHoverText = $derived(
	message.meta?.provider && message.meta?.model
		? `${message.meta.provider}/${modelName}`
		: "",
);

// Token display
function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

function formatCost(n: number): string {
	const formatted =
		n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4);
	return `$${formatted}`;
}

const hasUsage = $derived.by(() => {
	const u = message.meta?.usage;
	if (!u) return false;
	return Boolean(
		u.input ||
			u.output ||
			u.cacheRead ||
			u.cacheWrite ||
			u.totalTokens ||
			u.cost?.input ||
			u.cost?.output ||
			u.cost?.cacheRead ||
			u.cost?.cacheWrite ||
			u.cost?.total,
	);
});

const tokenDisplay = $derived.by(() => {
	const u = message.meta?.usage;
	if (!u) return "";
	const parts = [];
	if (u.input) parts.push(`↑${formatTokenCount(u.input)}`);
	if (u.output) parts.push(`↓${formatTokenCount(u.output)}`);
	if (parts.length > 0) return parts.join(" ");
	if (u.totalTokens) return `${formatTokenCount(u.totalTokens)} tokens`;
	if (u.cacheRead) return `cache ${formatTokenCount(u.cacheRead)}`;
	if (u.cacheWrite) return `cache write ${formatTokenCount(u.cacheWrite)}`;
	if (u.cost?.total) return formatCost(u.cost.total);
	return "";
});

const tokenDetailText = $derived.by(() => {
	const u = message.meta?.usage;
	if (!u) return "";
	const parts = [];
	if (u.input) parts.push(`↑ Input: ${formatTokenCount(u.input)}`);
	if (u.output) parts.push(`↓ Output: ${formatTokenCount(u.output)}`);
	if (u.cacheRead) parts.push(`Cache read: ${formatTokenCount(u.cacheRead)}`);
	if (u.cacheWrite)
		parts.push(`Cache write: ${formatTokenCount(u.cacheWrite)}`);
	if (u.totalTokens) parts.push(`Total: ${formatTokenCount(u.totalTokens)}`);
	if (u.cost?.total) parts.push(`Cost: ${formatCost(u.cost.total)}`);
	return parts.join("  ·  ");
});

// Copy
let copied = $state(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

function handleCopy() {
	const text =
		message.content
			?.filter((block) => block.type === "text")
			.map((block) => (block.type === "text" ? block.text : ""))
			.join("\n\n")
			.trim() || message.text;

	navigator.clipboard.writeText(text).then(() => {
		copied = true;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => {
			copied = false;
		}, 1800);
	});
}
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
          class="mt-1 inline-flex items-center gap-1 text-[11px] text-text-placeholder hover:text-text-tertiary cursor-pointer"
          onclick={toggleThinking}
        >
          <span>{thinkingExpanded ? 'Show less' : '… more'}</span>
        </button>
      {/if}
    </div>
  {/if}
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-full sm:max-w-[52rem]' : ''}`}>
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
    <div class={`px-2 py-2 text-[14px] leading-[1.7] ${message.role === 'user' ? 'bg-brand/5 text-text-primary rounded-xl rounded-br-md' : message.role === 'assistant' ? (assistantErrorMessage ? 'text-text-primary border border-status-error/30 rounded-xl bg-status-error/5' : 'text-text-primary') : message.role === 'system' ? 'bg-info-bg text-info-soft' : 'bg-error-bg text-error-soft'}`}>

      {#if thinkingContent}
        <div class="mb-3">
          <div class="text-[13px] leading-snug text-text-disabled break-words font-sans whitespace-pre-wrap">
            {getThinkingDisplay(thinkingExpanded)}
          </div>
          {#if thinkingNeedsTruncation}
            <button
              type="button"
              class="mt-1 inline-flex items-center gap-1 text-[11px] text-text-placeholder hover:text-text-tertiary cursor-pointer"
              onclick={toggleThinking}
            >
              <span>{thinkingExpanded ? 'Show less' : '… more'}</span>
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

      {#if isUserMessage}
        <div class="whitespace-pre-wrap break-words text-inherit">
          {textContent || (message.content?.length ? "" : message.text)}
        </div>
      {:else}
        <div
          bind:this={markdownEl}
          class="prose prose-sm prose-invert max-w-none text-inherit"
        >
          {@html renderedHtml}
        </div>
      {/if}

      {#if assistantErrorMessage}
        <div class="mt-3 rounded-lg border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error whitespace-pre-wrap break-words">
          <div class="font-medium">Error</div>
          <div class="mt-1">{assistantErrorMessage}</div>
        </div>
      {/if}

      <ToolCallList content={message.content ?? []} />

      {#if message.role === 'assistant' && (message.meta?.model || shortTime)}
        <!-- Meta bar: copy | model | tokens | time -->
        <div class="mt-2 flex items-center gap-1 text-[11px] text-text-placeholder/50 select-none">
          <!-- Copy button -->
          <button
            type="button"
            class="shrink-0 inline-flex items-center p-1 rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            onclick={(e) => { e.stopPropagation(); handleCopy(); }}
            title="Copy message"
          >
            {#if copied}
              <Check class="w-3.5 h-3.5 text-status-running" />
            {:else}
              <Copy class="w-3.5 h-3.5" />
            {/if}
          </button>

          <!-- Model (truncates when space is tight) -->
          {#if modelDisplayName}
            <span class="min-w-0 truncate cursor-default" title={modelHoverText}>
              {modelDisplayName}
            </span>
          {/if}

          <!-- Tokens -->
          {#if hasUsage}
            <span class="tabular-nums shrink-0 cursor-default" title={tokenDetailText}>
              {tokenDisplay}
            </span>
          {/if}

          <!-- Time (always visible on the right) -->
          {#if shortTime}
            <time datetime={message.createdAt} class="ml-auto shrink-0 tabular-nums cursor-default" title={fullDateTime}>
              {shortTime}
            </time>
          {/if}
        </div>
      {/if}

    </div>
  </div>
{/if}
