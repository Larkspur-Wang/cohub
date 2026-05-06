<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { Check, Copy, UserRound } from "lucide-svelte";
import MessageContentFlow from "$lib/components/MessageContentFlow.svelte";
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
	showToolCalls?: boolean;
};

const {
	message,
	modelsCatalog,
	onMarkdownRenderStart,
	onMarkdownRendered,
	showToolCalls = true,
}: Props = $props();
let pendingMarkdownSegments = $state(0);
let markdownStartedForSignature = $state("");

// Thinking state: track user manual toggle to avoid overriding
let thinkingExpanded = $state(false);
let thinkingUserToggled = $state(false);
// Auto-expand during streaming, auto-collapse after (unless user toggled)
const isStreaming = $derived(
	message.meta?.messageKind === "assistant_streaming_preview" ||
		message.meta?.streaming === true ||
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

const textSignature = $derived(
	(message.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n\n"),
);

function handleMarkdownSegmentRendered() {
	pendingMarkdownSegments = Math.max(0, pendingMarkdownSegments - 1);
	if (pendingMarkdownSegments === 0) onMarkdownRendered?.(message);
}

function handleMarkdownSegmentStart() {
	if (markdownStartedForSignature !== textSignature) {
		markdownStartedForSignature = textSignature;
		pendingMarkdownSegments = 0;
		onMarkdownRenderStart?.(message);
	}
	pendingMarkdownSegments += 1;
}

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

function shortenUserUuid(uuid?: string | null): string {
	if (!uuid) return "User";
	const compact = uuid.replaceAll("-", "");
	return compact.length > 8 ? compact.slice(0, 8) : compact;
}

const userDisplayName = $derived(
	message.authorName?.trim() || shortenUserUuid(message.authorUuid),
);

function toggleThinking() {
	thinkingExpanded = !thinkingExpanded;
	thinkingUserToggled = true;
}

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
  <MessageContentFlow
    content={message.content ?? []}
    {thinkingExpanded}
    {isStreaming}
    showToolCalls={false}
    onToggleThinking={toggleThinking}
  />
{:else}
  <div class={`w-full ${message.role === 'user' ? 'ml-auto max-w-full sm:max-w-[52rem]' : ''}`}>
    <div class={`px-2 py-2 text-[14px] leading-[1.7] ${message.role === 'user' ? 'bg-brand/5 text-text-primary rounded-xl rounded-br-md' : message.role === 'assistant' ? (assistantErrorMessage ? 'text-text-primary rounded-xl bg-status-error/5' : 'text-text-primary') : message.role === 'system' ? 'bg-info-bg text-info-soft' : 'bg-error-bg text-error-soft'}`}>

      <MessageContentFlow
        content={message.content?.length ? message.content : [{ type: 'text', text: message.text }]}
        {isUserMessage}
        {thinkingExpanded}
        {isStreaming}
        {showToolCalls}
        onToggleThinking={toggleThinking}
        onMarkdownSegmentRendered={handleMarkdownSegmentRendered}
        onMarkdownSegmentStart={handleMarkdownSegmentStart}
        onLoadToolCalls={message.toolCallsLoader ?? undefined}
      />

      {#if assistantErrorMessage}
        <div class="mt-3 rounded-lg border border-status-error/30 bg-status-error/8 px-3 py-2 text-[12px] text-status-error whitespace-pre-wrap break-words">
          <div class="font-medium">Error</div>
          <div class="mt-1">{assistantErrorMessage}</div>
        </div>
      {/if}

    </div>

    {#if (message.role === 'assistant' && (message.meta?.model || shortTime)) || (message.role === 'user' && shortTime)}
      <!-- Meta bar: copy | identity/model | tokens | time -->
      <div class="mt-1 flex items-center gap-1 px-2 text-[11px] text-text-placeholder/50 select-none">
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

        {#if message.role === 'user'}
          <!-- User identity -->
          <span class="inline-flex min-w-0 items-center gap-1.5 cursor-default" title={message.authorUuid ?? userDisplayName}>
            {#if message.authorAvatar}
              <img src={message.authorAvatar} alt="" class="w-4 h-4 rounded-full shrink-0" />
            {:else}
              <span class="w-4 h-4 rounded-full bg-brand/15 flex items-center justify-center text-brand shrink-0">
                <UserRound class="w-3 h-3" aria-hidden="true" />
              </span>
            {/if}
            <span class="min-w-0 truncate">{userDisplayName}</span>
          </span>
        {:else}
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
{/if}
