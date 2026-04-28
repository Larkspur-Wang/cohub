<script lang="ts">
import { ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import type { ChatMessage } from "$lib/session-tree";

type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

type Props = {
	messages: ChatMessage[];
	modelsCatalog?: ModelCatalogItem[];
	onLoadMessageDetail?: (message: ChatMessage) => Promise<void>;
	onLoadMessageSummary?: (message: ChatMessage) => Promise<void>;
	onMarkdownRenderStart?: (message: ChatMessage) => void;
	onMarkdownRendered?: (message: ChatMessage) => void;
};

const {
	messages,
	modelsCatalog,
	onLoadMessageDetail,
	onLoadMessageSummary,
	onMarkdownRenderStart,
	onMarkdownRendered,
}: Props = $props();

let expanded = $state(false);
let loadingSummaries = $state(false);
let summaryLoadPromise: Promise<void> | null = null;

const placeholderMessages = $derived(
	messages.filter(
		(message) => message.meta?.contentPlaceholder === "assistant_intermediate",
	),
);

async function ensureSummaries() {
	if (placeholderMessages.length === 0 || !onLoadMessageSummary) return;
	if (summaryLoadPromise) {
		await summaryLoadPromise;
		return;
	}
	loadingSummaries = true;
	summaryLoadPromise = Promise.all(
		placeholderMessages.map((message) => onLoadMessageSummary(message)),
	).then(() => undefined);
	try {
		await summaryLoadPromise;
	} finally {
		summaryLoadPromise = null;
		loadingSummaries = false;
	}
}

async function toggle() {
	if (!expanded) {
		await ensureSummaries();
	}
	expanded = !expanded;
}

const toolCallCount = $derived(
	messages.reduce(
		(sum, msg) =>
			sum +
			(typeof msg.meta?.historySummary === "object" &&
			msg.meta.historySummary !== null &&
			"toolCallCount" in msg.meta.historySummary &&
			typeof msg.meta.historySummary.toolCallCount === "number"
				? msg.meta.historySummary.toolCallCount
				: (msg.content?.filter((b) => b.type === "tool_use").length ?? 0)),
		0,
	),
);

const thinkingCharCount = $derived(
	messages.reduce((sum, msg) => {
		if (
			typeof msg.meta?.historySummary === "object" &&
			msg.meta.historySummary !== null &&
			"thinkingCharCount" in msg.meta.historySummary &&
			typeof msg.meta.historySummary.thinkingCharCount === "number"
		) {
			return sum + msg.meta.historySummary.thinkingCharCount;
		}
		const thinking =
			msg.content
				?.filter((b) => b.type === "thinking")
				.map((b) => (b.type === "thinking" ? b.thinking : ""))
				.join("") ?? "";
		return sum + thinking.length;
	}, 0),
);

const labelParts = $derived(
	[
		messages.length > 0
			? `${messages.length} message${messages.length > 1 ? "s" : ""}`
			: "",
		toolCallCount > 0
			? `${toolCallCount} tool${toolCallCount > 1 ? "s" : ""}`
			: "",
		thinkingCharCount > 0 ? `${thinkingCharCount} chars thinking` : "",
	].filter(Boolean),
);

const summaryLabel = $derived(labelParts.join(" · "));
</script>

{#if !expanded}
	<button
		type="button"
		class="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md disabled:cursor-wait disabled:opacity-75"
		disabled={loadingSummaries}
		onclick={() => void toggle()}
	>
		{#if loadingSummaries}
			<Loader2 class="w-3.5 h-3.5 text-text-tertiary shrink-0 animate-spin" />
		{:else}
			<ChevronRight class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
		{/if}
		<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
	</button>
{:else}
	<div class="flex flex-col gap-0">
		<button
			type="button"
			class="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md"
			onclick={() => void toggle()}
		>
			<ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
			<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
		</button>

		<div class="flex flex-col gap-2 pl-2 border-l border-border-subtle/40 ml-2">
			{#each messages as msg (msg.id)}
					<ChatMessageBubble message={msg} {modelsCatalog} {onLoadMessageDetail} {onMarkdownRenderStart} {onMarkdownRendered} />
			{/each}
		</div>

		<button
			type="button"
			class="flex items-center gap-1.5 px-4 py-1.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer text-text-placeholder hover:text-text-tertiary rounded-md self-start"
			onclick={() => void toggle()}
		>
			<ChevronRight class="w-3 h-3" />
			<span class="text-[11px]">Collapse</span>
		</button>
	</div>
{/if}
