<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import type {
	MessageToolCallsFile,
	SessionTurnIndexItem,
	SessionTurnRecord,
	StoredIntermediateMessage,
} from "@cohub/protocol/model";
import {
	ArrowLeft,
	Loader2,
	MessageSquare,
	PanelLeftClose,
	Search,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ProcessCard from "$lib/components/ProcessCard.svelte";
import type { ChatMessage } from "$lib/session-tree";
import {
	buildStreamingPreviewBlocks,
	turnToAssistantMessage,
	turnToUserMessage,
} from "$lib/session-turn-render";
import {
	formatCompactAbsoluteTime,
	formatFullAbsoluteTime,
} from "$lib/time-format";

type ModelCatalogItem = {
	provider: string;
	id: string;
	model: Record<string, unknown>;
};
type StreamingTurnState = {
	sessionId: string;
	turnId?: string | null;
	anchorUserMessageId?: string | null;
	contentBlocks: ContentBlock[];
	intermediateMessages?: StoredIntermediateMessage[];
	finalizedPreview?: boolean;
	status?: string;
} | null;

type Props = {
	turns: SessionTurnRecord[];
	turnIndexItems: SessionTurnIndexItem[];
	selectedSequence: number | null;
	olderCount?: number;
	newerCount?: number;
	hasMoreOlder?: boolean;
	hasMoreNewer?: boolean;
	loadingOlder?: boolean;
	loadingNewer?: boolean;
	listWidth?: number;
	listMinWidth?: number;
	listMaxWidth?: number;
	streaming?: StreamingTurnState;
	modelsCatalog?: ModelCatalogItem[];
	onSelectTurn?: (sequence: number) => void;
	onJumpToChat?: (sequence: number) => void;
	onLoadOlder?: () => void;
	onLoadNewer?: () => void;
	onListWidthChange?: (width: number) => void;
	onMarkdownRenderStart?: (message: ChatMessage) => void;
	onMarkdownRendered?: (message: ChatMessage) => void;
	onLoadIntermediate?: (
		turn: SessionTurnRecord,
	) => Promise<StoredIntermediateMessage[]>;
	onLoadToolCalls?: (input: {
		turn: SessionTurnRecord;
		message: StoredIntermediateMessage;
	}) => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (path: string) => void;
	onForkTurn?: (turn: SessionTurnRecord) => void;
	forkingTurnId?: string | null;
};

let {
	turns,
	turnIndexItems,
	selectedSequence,
	olderCount = 0,
	newerCount = 0,
	hasMoreOlder = false,
	hasMoreNewer = false,
	loadingOlder = false,
	loadingNewer = false,
	listWidth = 320,
	listMinWidth = 260,
	listMaxWidth = 460,
	streaming = null,
	modelsCatalog,
	onSelectTurn,
	onJumpToChat,
	onLoadOlder,
	onLoadNewer,
	onListWidthChange,
	onMarkdownRenderStart,
	onMarkdownRendered,
	onLoadIntermediate,
	onLoadToolCalls,
	onOpenFile,
	onForkTurn,
	forkingTurnId = null,
}: Props = $props();

let query = $state("");
let mobileDetailOpen = $state(false);
let resizeCleanup: (() => void) | null = null;

function clampWidth(width: number) {
	return Math.min(listMaxWidth, Math.max(listMinWidth, width));
}

function beginListResize(event: PointerEvent) {
	event.preventDefault();
	if (window.innerWidth < 768) return;
	const target = event.currentTarget as HTMLElement | null;
	target?.setPointerCapture?.(event.pointerId);
	resizeCleanup?.();
	const startX = event.clientX;
	const startWidth = listWidth;
	const onPointerMove = (moveEvent: PointerEvent) => {
		onListWidthChange?.(clampWidth(startWidth + moveEvent.clientX - startX));
	};
	const stop = () => {
		if (target?.hasPointerCapture?.(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		document.body.classList.remove("sidebar-resizing");
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", stop);
		window.removeEventListener("pointercancel", stop);
		if (resizeCleanup === stop) resizeCleanup = null;
	};
	resizeCleanup = stop;
	document.body.classList.add("sidebar-resizing");
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", stop);
	window.addEventListener("pointercancel", stop);
}

onDestroy(() => resizeCleanup?.());

const turnsBySequence = $derived.by(() => {
	const map = new Map<number, SessionTurnRecord>();
	for (const turn of turns) map.set(turn.sequence, turn);
	return map;
});

const rows = $derived.by(() => {
	const bySequence = new Map<number, SessionTurnIndexItem>();
	for (const item of turnIndexItems) bySequence.set(item.sequence, item);
	for (const turn of turns) {
		bySequence.set(turn.sequence, {
			...bySequence.get(turn.sequence),
			id: turn.id,
			sessionId: turn.sessionId,
			sequence: turn.sequence,
			status: turn.status,
			startedAt: turn.startedAt,
			completedAt: turn.completedAt,
			durationMs: turn.durationMs,
			createdAt: turn.createdAt,
			updatedAt: turn.updatedAt,
			userPreview: turn.userText,
			assistantPreview: turn.assistantText,
			provider: turn.provider,
			model: turn.model,
			finalUsage: turn.finalUsage,
			totalUsage: turn.totalUsage,
			errorMessage: turn.errorMessage,
		});
	}
	return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
});

const filteredRows = $derived.by(() => {
	const needle = query.trim().toLowerCase();
	if (!needle) return rows;
	return rows.filter((row) => {
		const haystack =
			`${row.sequence} ${row.userPreview ?? ""} ${row.assistantPreview ?? ""} ${row.model ?? ""}`.toLowerCase();
		return haystack.includes(needle);
	});
});

const effectiveSelectedSequence = $derived.by(() => {
	if (
		selectedSequence &&
		rows.some((row) => row.sequence === selectedSequence)
	) {
		return selectedSequence;
	}
	return rows.at(-1)?.sequence ?? null;
});

const selectedTurn = $derived.by(() =>
	effectiveSelectedSequence
		? (turnsBySequence.get(effectiveSelectedSequence) ?? null)
		: null,
);

const selectedIndexItem = $derived.by(() =>
	effectiveSelectedSequence
		? (rows.find((row) => row.sequence === effectiveSelectedSequence) ?? null)
		: null,
);

const streamingForSelectedTurn = $derived.by(() => {
	if (!streaming || !selectedTurn) return false;
	return !streaming.turnId || streaming.turnId === selectedTurn.id;
});

const assistantMessage = $derived.by<ChatMessage | null>(() => {
	const turn = selectedTurn;
	if (!turn) return null;
	const isAborted = turn.stopReason === "aborted";
	const isStreamingSelected = streamingForSelectedTurn;
	if (isStreamingSelected && streaming?.contentBlocks.length) {
		const blocks = buildStreamingPreviewBlocks(streaming.contentBlocks);
		return {
			id: `turn:${turn.id}:assistant:streaming-split`,
			sourceId: turn.id,
			role: "assistant",
			content: blocks,
			text: blocks.find((block) => block.type === "text")?.text ?? "",
			sequence: turn.sequence * 10 + 2,
			createdAt: new Date().toISOString(),
			meta: {
				messageKind: "assistant_streaming_preview",
				streaming: true,
				turnId: turn.id,
			},
		};
	}
	if (
		!turn.assistantContent &&
		!turn.errorMessage &&
		!turn.assistantText &&
		!isAborted
	) {
		return null;
	}
	const message = turnToAssistantMessage(turn);
	return message ? { ...message, id: `turn:${turn.id}:assistant:split` } : null;
});

const userMessage = $derived.by<ChatMessage | null>(() => {
	const turn = selectedTurn;
	if (!turn) return null;
	return { ...turnToUserMessage(turn), id: `turn:${turn.id}:user:split` };
});

$effect(() => {
	if (!effectiveSelectedSequence) return;
	if (!selectedSequence) onSelectTurn?.(effectiveSelectedSequence);
});

$effect(() => {
	if (!selectedSequence) return;
	mobileDetailOpen = true;
});

function previewText(row: SessionTurnIndexItem) {
	return (row.userPreview ?? "").trim() || "Empty user message";
}

function statusClass(status: string | null | undefined) {
	if (status === "failed") return "text-status-error";
	if (status === "running" || status === "pending")
		return "text-status-running";
	if (status === "interrupted" || status === "cancelled")
		return "text-warning-soft";
	return "text-text-placeholder";
}

function selectTurn(sequence: number) {
	onSelectTurn?.(sequence);
	mobileDetailOpen = true;
}
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col bg-bg-content md:flex-row">
	<aside
		class={`relative min-h-0 border-border-subtle bg-bg-content md:flex md:shrink-0 md:flex-col md:border-r ${mobileDetailOpen ? 'hidden md:flex' : 'flex flex-1 flex-col'}`}
		style:width={`${clampWidth(listWidth)}px`}
	>
		<div class="shrink-0 border-b border-border-subtle px-3 py-2.5">
			<div class="flex items-center gap-2 rounded-[6px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-tertiary focus-within:border-brand/40">
				<Search class="h-3.5 w-3.5 shrink-0" />
				<input
					bind:value={query}
					type="search"
					placeholder="Filter user messages"
					class="min-w-0 flex-1 bg-transparent text-text-primary placeholder:text-text-placeholder outline-none"
				/>
			</div>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if hasMoreOlder || olderCount > 0}
				<button type="button" class="flex w-full items-center justify-center gap-2 border-b border-border-subtle px-3 py-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-60" onclick={onLoadOlder} disabled={loadingOlder}>
					{#if loadingOlder}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
					<span>{loadingOlder ? 'Loading older turns…' : olderCount > 0 ? `Load ${olderCount} older turns` : 'Load older turns'}</span>
				</button>
			{/if}
			{#if filteredRows.length === 0}
				<div class="px-4 py-8 text-center text-[12px] text-text-tertiary">No matching user messages.</div>
			{:else}
				<div class="divide-y divide-border-subtle/70">
					{#each filteredRows as row (row.sequence)}
						{@const selected = row.sequence === effectiveSelectedSequence}
						<button
							type="button"
							class={`group block w-full px-3 py-2.5 text-left transition-colors hover:bg-bg-hover/70 ${selected ? 'bg-bg-hover' : ''}`}
							onclick={() => selectTurn(row.sequence)}
						>
							<div class="min-w-0">
								<div class="line-clamp-3 whitespace-pre-wrap text-[13px] leading-[1.45] text-text-primary">{previewText(row)}</div>
								<div class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none">
									<span class="shrink-0 tabular-nums text-text-placeholder/70">#{row.sequence}</span>
									<span class="text-text-placeholder">·</span>
									<span class={`shrink-0 ${statusClass(row.status)}`}>{row.status ?? 'turn'}</span>
									<span class="text-text-placeholder">·</span>
									<time class="shrink-0 tabular-nums text-text-placeholder" datetime={row.startedAt ?? row.createdAt} title={formatFullAbsoluteTime(row.startedAt ?? row.createdAt)}>{formatCompactAbsoluteTime(row.startedAt ?? row.createdAt)}</time>
									{#if row.model}
										<span class="text-text-placeholder">·</span>
										<span class="min-w-0 truncate text-text-placeholder">{row.model}</span>
									{/if}
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
			{#if hasMoreNewer || newerCount > 0}
				<button type="button" class="flex w-full items-center justify-center gap-2 border-t border-border-subtle px-3 py-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-60" onclick={onLoadNewer} disabled={loadingNewer}>
					{#if loadingNewer}<Loader2 class="h-3.5 w-3.5 animate-spin" />{/if}
					<span>{loadingNewer ? 'Loading newer turns…' : newerCount > 0 ? `Load ${newerCount} newer turns` : 'Load newer turns'}</span>
				</button>
			{/if}
		</div>
		<button
			type="button"
			class="split-resize-handle hidden md:block"
			onpointerdown={beginListResize}
			aria-label="Resize turn list"
			title="Resize turn list"
		></button>
	</aside>

	<section class={`min-h-0 min-w-0 flex-1 flex-col ${mobileDetailOpen ? 'flex' : 'hidden md:flex'}`}>
		<div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
			<button type="button" class="flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary md:hidden" onclick={() => mobileDetailOpen = false}>
				<ArrowLeft class="h-4 w-4" />
				Turns
			</button>
			<div class="min-w-0 flex-1">
				{#if selectedIndexItem}
					<div class="truncate text-[12px] font-medium text-text-secondary">Turn #{selectedIndexItem.sequence}</div>
					<div class="truncate text-[11px] text-text-placeholder">{selectedIndexItem.status ?? 'turn'} · {formatCompactAbsoluteTime(selectedIndexItem.startedAt ?? selectedIndexItem.createdAt)}{selectedIndexItem.model ? ` · ${selectedIndexItem.model}` : ''}</div>
				{:else}
					<div class="text-[12px] text-text-tertiary">Select a turn</div>
				{/if}
			</div>
			{#if effectiveSelectedSequence}
				<button type="button" class="hidden h-8 items-center gap-1.5 rounded-[5px] px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary sm:flex" onclick={() => onJumpToChat?.(effectiveSelectedSequence)} title="Open this turn in chat">
					<PanelLeftClose class="h-3.5 w-3.5" />
					Chat
				</button>
			{/if}
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
			<div class="mx-auto flex max-w-4xl flex-col gap-3 pb-6">
				{#if !selectedTurn}
					<div class="flex min-h-[42vh] flex-col items-center justify-center gap-2 text-center text-text-tertiary">
						<MessageSquare class="h-5 w-5" />
						<div class="text-[13px]">Select a user message to inspect the turn.</div>
					</div>
				{:else}
					{#if userMessage}
						<ChatMessageBubble message={userMessage} {modelsCatalog} {onMarkdownRenderStart} {onMarkdownRendered} {onOpenFile} onForkTurn={onForkTurn ? () => onForkTurn(selectedTurn) : undefined} forkDisabled={Boolean(forkingTurnId)} forking={forkingTurnId === selectedTurn.id} />
					{/if}
					{#if selectedTurn.intermediateSummary && selectedTurn.intermediateSummary.messageCount > 0}
						<ProcessCard turn={selectedTurn} summary={selectedTurn.intermediateSummary} intermediateMessages={streamingForSelectedTurn ? streaming?.intermediateMessages : null} streaming={streamingForSelectedTurn && Boolean(streaming?.intermediateMessages?.length)} {modelsCatalog} {onLoadIntermediate} {onLoadToolCalls} {onOpenFile} />
					{:else if streamingForSelectedTurn && streaming?.intermediateMessages?.length}
						<ProcessCard turn={selectedTurn} summary={{ messageCount: streaming.intermediateMessages.length, toolCallCount: streaming.intermediateMessages.reduce((count, message) => count + message.content.filter((block) => block.type === 'tool_use').length, 0) }} intermediateMessages={streaming.intermediateMessages} streaming={true} {modelsCatalog} {onLoadIntermediate} {onLoadToolCalls} {onOpenFile} />
					{/if}
					{#if assistantMessage}
						<ChatMessageBubble message={assistantMessage} {modelsCatalog} {onMarkdownRenderStart} {onMarkdownRendered} {onOpenFile} />
					{:else}
						<div class="rounded-[8px] border border-border-subtle bg-bg-surface px-3 py-3 text-[12px] text-text-tertiary">
							{selectedTurn.status === 'running' || selectedTurn.status === 'queued' || selectedTurn.status === 'abort_requested' ? 'Waiting for final message…' : 'No final message for this turn.'}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</section>
</div>

<style>
	.split-resize-handle {
		position: absolute;
		top: 0;
		right: -4px;
		width: 8px;
		height: 100%;
		border: none;
		padding: 0;
		cursor: col-resize;
		background: transparent;
		touch-action: none;
		z-index: 10;
	}

	.split-resize-handle::after {
		content: "";
		position: absolute;
		left: 3px;
		top: 0;
		width: 2px;
		height: 100%;
		background: transparent;
		transition: background-color 120ms ease;
	}

	.split-resize-handle:hover::after,
	:global(body.sidebar-resizing) .split-resize-handle::after {
		background: var(--border-subtle);
	}
</style>
