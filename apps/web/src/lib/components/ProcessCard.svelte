<script lang="ts">
import type {
	MessageToolCallsFile,
	SessionTurnIntermediateSummary,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@neta-art/cohub-protocol/model";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";
import IntermediateMessageBubble from "$lib/components/IntermediateMessageBubble.svelte";

type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};

type Props = {
	turn: SessionTurnRecord;
	summary?: SessionTurnIntermediateSummary;
	intermediateMessages?: StoredIntermediateMessage[] | null;
	streaming?: boolean;
	modelsCatalog?: ModelCatalogItem[];
	onLoadIntermediate?: (
		turn: SessionTurnRecord,
	) => Promise<StoredIntermediateMessage[]>;
	onLoadToolCalls?: (input: {
		turn: SessionTurnRecord;
		message: StoredIntermediateMessage;
	}) => Promise<MessageToolCallsFile | null>;
};

const {
	turn,
	summary,
	intermediateMessages: liveIntermediateMessages = null,
	streaming = false,
	modelsCatalog,
	onLoadIntermediate,
	onLoadToolCalls,
}: Props = $props();

let expanded = $state(false);
let loading = $state(false);
let loadError = $state<string | null>(null);
let loadedIntermediateMessages = $state<StoredIntermediateMessage[] | null>(
	null,
);

const effectiveMessages = $derived(
	liveIntermediateMessages ?? loadedIntermediateMessages ?? [],
);
const expandedMessages = $derived(effectiveMessages);

async function ensureLoaded() {
	if (liveIntermediateMessages) return;
	if (!onLoadIntermediate) return;
	if (loadedIntermediateMessages) return;
	loading = true;
	loadError = null;
	try {
		loadedIntermediateMessages = await onLoadIntermediate(turn);
	} catch (error) {
		loadError =
			error instanceof Error
				? error.message
				: "Failed to load process details. Please retry";
	} finally {
		loading = false;
	}
}

async function toggle() {
	if (!expanded) await ensureLoaded();
	expanded = !expanded;
}

const toolCallCount = $derived(summary?.toolCallCount ?? 0);
const messageCount = $derived(
	Math.max(summary?.messageCount ?? 0, effectiveMessages.length),
);
const usageTokens = $derived(
	summary?.usage?.totalTokens ??
		((summary?.usage?.input ?? 0) + (summary?.usage?.output ?? 0) || 0),
);
const labelParts = $derived(
	[
		messageCount > 0
			? `${messageCount} step${messageCount > 1 ? "s" : ""}`
			: streaming
				? "Running"
				: "",
		toolCallCount > 0
			? `${toolCallCount} tool${toolCallCount > 1 ? "s" : ""}`
			: "",
		usageTokens > 0 ? `${usageTokens} tokens` : "",
	].filter(Boolean),
);
const summaryLabel = $derived(
	labelParts.join(" · ") || (streaming ? "Running…" : "Process"),
);
</script>

{#if !expanded}
	<button type="button" class="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md disabled:cursor-wait disabled:opacity-75" disabled={loading} onclick={() => void toggle()}>
		{#if loading}<Loader2 class="w-3.5 h-3.5 text-text-tertiary shrink-0 animate-spin" />{:else}<ChevronRight class="w-3.5 h-3.5 text-text-tertiary shrink-0" />{/if}
		<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
	</button>
{:else}
	<div class="flex flex-col gap-0">
		<button type="button" class="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md" onclick={() => void toggle()}>
			<ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
			<span class="text-[13px] text-text-tertiary">{summaryLabel}</span>
		</button>
		<div class="flex flex-col gap-2">
			{#if loadError}
				<button type="button" class="mx-2 rounded-md border border-status-error/30 bg-status-error/5 px-3 py-2 text-left text-[12px] text-status-error hover:bg-status-error/10" onclick={() => void ensureLoaded()}>
					{loadError} · Click to retry
				</button>
			{/if}
			{#each expandedMessages as msg (msg.id)}
				<IntermediateMessageBubble message={msg} {modelsCatalog} onLoadToolCalls={onLoadToolCalls ? () => onLoadToolCalls({ turn, message: msg }) : undefined} />
			{/each}
		</div>
		<button type="button" class="flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer text-text-placeholder hover:text-text-tertiary rounded-md self-start" onclick={() => void toggle()}>
			<ChevronRight class="w-3 h-3" />
			<span class="text-[11px]">Collapse</span>
		</button>
	</div>
{/if}
