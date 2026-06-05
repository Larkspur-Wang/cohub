<script lang="ts">
import type {
	MessageToolCallsFile,
	SessionTurnIntermediateSummary,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";
import GenerationRuntimeStatusRow from "$lib/components/GenerationRuntimeStatusRow.svelte";
import IntermediateMessageBubble from "$lib/components/IntermediateMessageBubble.svelte";
import {
	formatDurationDetail,
	formatDurationMs,
	isDisplayableDurationMs,
} from "$lib/format-duration";

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
	runtimePhase?: "llm_call_started" | null;
	runtimeModel?: string | null;
	modelsCatalog?: ModelCatalogItem[];
	onLoadIntermediate?: (
		turn: SessionTurnRecord,
	) => Promise<StoredIntermediateMessage[]>;
	onLoadToolCalls?: (input: {
		turn: SessionTurnRecord;
		message: StoredIntermediateMessage;
	}) => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (path: string) => void;
};

const {
	turn,
	summary,
	intermediateMessages: liveIntermediateMessages = null,
	streaming = false,
	runtimePhase = null,
	runtimeModel = null,
	modelsCatalog,
	onLoadIntermediate,
	onLoadToolCalls,
	onOpenFile,
}: Props = $props();

let expanded = $state(false);
let loading = $state(false);
let loadError = $state<string | null>(null);
let loadedIntermediateMessages = $state<StoredIntermediateMessage[] | null>(
	null,
);

const effectiveMessages = $derived(
	streaming
		? (liveIntermediateMessages ?? loadedIntermediateMessages ?? [])
		: (loadedIntermediateMessages ?? []),
);
const expandedMessages = $derived(effectiveMessages);

async function ensureLoaded() {
	if (streaming && liveIntermediateMessages) return;
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

function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

const toolCallCount = $derived(summary?.toolCallCount ?? 0);
const messageCount = $derived(
	Math.max(summary?.messageCount ?? 0, effectiveMessages.length),
);
const usageInputTokens = $derived.by(() => {
	const usage = summary?.usage;
	if (!usage) return 0;
	return (usage.input ?? 0) + (usage.cacheRead ?? 0);
});
const usageCachedTokens = $derived.by(() => summary?.usage?.cacheRead ?? 0);
const usageOutputTokens = $derived.by(() => summary?.usage?.output ?? 0);
const usageTokens = $derived(
	summary?.usage?.totalTokens ??
		((summary?.usage?.input ?? 0) + (summary?.usage?.output ?? 0) || 0),
);
const usageBreakdownLabel = $derived.by(() => {
	if (usageInputTokens <= 0 && usageOutputTokens <= 0) return "";
	const inputLabel =
		usageInputTokens > 0 ? `↑${formatTokenCount(usageInputTokens)}` : "";
	const cachedLabel =
		usageCachedTokens > 0
			? `(${formatTokenCount(usageCachedTokens)} cached)`
			: "";
	const outputLabel =
		usageOutputTokens > 0 ? `↓${formatTokenCount(usageOutputTokens)}` : "";
	return [inputLabel, cachedLabel, outputLabel].filter(Boolean).join(" ");
});
const durationLabel = $derived(
	isDisplayableDurationMs(summary?.durationMs)
		? formatDurationMs(summary.durationMs)
		: "",
);
const durationTitle = $derived(
	isDisplayableDurationMs(summary?.durationMs)
		? formatDurationDetail(summary.durationMs)
		: "",
);
const usageTitle = $derived.by(() => {
	if (!summary?.usage && !durationTitle) return "";
	const parts = [];
	if (usageInputTokens > 0) {
		parts.push(
			usageCachedTokens > 0
				? `Input: ${formatTokenCount(usageInputTokens)} (${formatTokenCount(usageCachedTokens)} cached)`
				: `Input: ${formatTokenCount(usageInputTokens)}`,
		);
	}
	if (usageOutputTokens > 0)
		parts.push(`Output: ${formatTokenCount(usageOutputTokens)}`);
	if (summary?.usage?.cacheWrite)
		parts.push(`Cache write: ${formatTokenCount(summary.usage.cacheWrite)}`);
	if (usageTokens > 0) parts.push(`Total: ${formatTokenCount(usageTokens)}`);
	if (durationTitle) parts.push(durationTitle);
	return parts.join(" · ");
});
const waitingLabel = $derived(
	runtimePhase === "llm_call_started"
		? runtimeModel?.trim()
			? `waiting ${runtimeModel.trim()}`
			: "waiting model"
		: "",
);
const startingLabel = $derived(
	streaming && !waitingLabel && effectiveMessages.length === 0
		? "starting agent"
		: "",
);
const runtimeLabel = $derived(waitingLabel || startingLabel);
const runtimeDisplayLabel = $derived(runtimeLabel ? `${runtimeLabel}...` : "");
const isRuntimeOnly = $derived(
	Boolean(runtimeLabel && messageCount === 0 && toolCallCount === 0),
);
const labelParts = $derived(
	[
		messageCount > 0
			? `${messageCount} step${messageCount > 1 ? "s" : ""}`
			: runtimeLabel
				? ""
				: streaming
					? "starting agent"
					: "",
		toolCallCount > 0
			? `${toolCallCount} tool${toolCallCount > 1 ? "s" : ""}`
			: "",
		runtimeLabel,
		usageBreakdownLabel ||
			(usageTokens > 0 ? `${formatTokenCount(usageTokens)} tokens` : ""),
		durationLabel,
	].filter(Boolean),
);
const summaryLabel = $derived(
	labelParts.join(" · ") || (streaming ? "Running…" : "Process"),
);
</script>

{#if !expanded}
	{#if isRuntimeOnly}
		<div class="px-2 py-1.5">
			<GenerationRuntimeStatusRow label={runtimeDisplayLabel} compact />
		</div>
	{:else}
		<button type="button" class="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md disabled:cursor-wait disabled:opacity-75" disabled={loading} onclick={() => void toggle()} title={usageTitle || undefined}>
			{#if loading}<Loader2 class="w-3.5 h-3.5 text-text-tertiary shrink-0 animate-spin" />{:else}<ChevronRight class="w-3.5 h-3.5 text-text-tertiary shrink-0" />{/if}
			<span class="text-[13px] text-text-tertiary tabular-nums">{summaryLabel}</span>
		</button>
	{/if}
{:else}
	<div class="flex flex-col gap-0">
		<button type="button" class="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer rounded-md" onclick={() => void toggle()} title={usageTitle || undefined}>
			<ChevronDown class="w-3.5 h-3.5 text-text-tertiary shrink-0" />
			<span class="text-[13px] text-text-tertiary tabular-nums">{summaryLabel}</span>
		</button>
		<div class="flex flex-col gap-2">
			{#if loadError}
				<button type="button" class="mx-2 rounded-md border border-status-error/30 bg-status-error/5 px-3 py-2 text-left text-[12px] text-status-error hover:bg-status-error/10" onclick={() => void ensureLoaded()}>
					{loadError} · Click to retry
				</button>
			{/if}
			{#each expandedMessages as msg (msg.id)}
				<IntermediateMessageBubble message={msg} streaming={streaming} {modelsCatalog} onLoadToolCalls={onLoadToolCalls ? () => onLoadToolCalls({ turn, message: msg }) : undefined} {onOpenFile} />
			{/each}
			{#if runtimeLabel}
				<div class="pl-5">
					<GenerationRuntimeStatusRow label={runtimeDisplayLabel} />
				</div>
			{/if}
		</div>
		<button type="button" class="flex items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer text-text-placeholder hover:text-text-tertiary rounded-md self-start" onclick={() => void toggle()}>
			<ChevronRight class="w-3 h-3" />
			<span class="text-[11px]">Collapse</span>
		</button>
	</div>
{/if}
