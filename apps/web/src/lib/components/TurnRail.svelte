<script lang="ts">
import type {
	SessionTurnIndexItem,
	SessionTurnRecord,
} from "@neta-art/cohub-protocol/model";
import { Loader2 } from "lucide-svelte";

type Marker = {
	turn: SessionTurnIndexItem;
	top: number;
	loaded: boolean;
	current: boolean;
};

type Props = {
	turns: SessionTurnIndexItem[];
	loadedTurns?: SessionTurnRecord[];
	markerPositions?: Record<number, number>;
	olderCount?: number;
	newerCount?: number;
	hasMoreOlder?: boolean;
	hasMoreNewer?: boolean;
	loadingOlder?: boolean;
	currentSequence?: number | null;
	loadingSequence?: number | null;
	onJump?: (sequence: number) => void;
	onLoadOlder?: () => void;
	onLoadNewer?: () => void;
};

let {
	turns,
	loadedTurns = [],
	markerPositions = {},
	olderCount = 0,
	newerCount = 0,
	hasMoreOlder = false,
	hasMoreNewer = false,
	loadingOlder = false,
	currentSequence = null,
	loadingSequence = null,
	onJump,
	onLoadOlder,
	onLoadNewer,
}: Props = $props();

let hovered = $state<Marker | null>(null);

const loadedSequences = $derived(
	new Set(loadedTurns.map((turn) => turn.sequence)),
);
const positionedTurns = $derived(
	turns.filter((turn) => markerPositions[turn.sequence] != null),
);
const minSequence = $derived(turns.at(0)?.sequence ?? 0);
const maxSequence = $derived(turns.at(-1)?.sequence ?? minSequence);
const span = $derived(Math.max(1, maxSequence - minSequence));
const effectiveCurrent = $derived.by(() => {
	if (currentSequence != null) return currentSequence;
	return loadedTurns.at(-1)?.sequence ?? null;
});
const markers = $derived.by<Marker[]>(() =>
	positionedTurns.map((turn) => ({
		turn,
		top:
			markerPositions[turn.sequence] ??
			((turn.sequence - minSequence) / span) * 100,
		loaded: loadedSequences.has(turn.sequence),
		current: effectiveCurrent === turn.sequence,
	})),
);
const shouldShow = $derived(
	markers.length > 1 || hasMoreOlder || hasMoreNewer || loadingOlder,
);

function statusClass(status: SessionTurnIndexItem["status"]) {
	if (status === "failed") return "bg-error-soft";
	if (status === "running") return "bg-info";
	if (status === "interrupted") return "bg-warning-soft";
	return "bg-text-tertiary";
}

function turnLabel(turn: SessionTurnIndexItem) {
	return `#${turn.sequence}`;
}

function countLabel(count: number) {
	if (count <= 0) return "more";
	return Intl.NumberFormat("en", { notation: "compact" }).format(count);
}

function metaLabel(turn: SessionTurnIndexItem) {
	const parts: string[] = [turn.status];
	if (turn.model) parts.push(turn.model);
	const total = turn.usage?.totalTokens;
	if (total) {
		parts.push(
			`${Intl.NumberFormat("en", { notation: "compact" }).format(total)} tokens`,
		);
	}
	return parts.join(" · ");
}
</script>

{#if shouldShow}
	<div class="pointer-events-none absolute inset-y-8 right-1 z-10 hidden w-7 lg:block">
		<div class="absolute right-3 top-0 h-full w-px bg-border-subtle/70"></div>
		{#if hasMoreOlder || olderCount > 0 || loadingOlder}
			<button
				type="button"
				class="group pointer-events-auto absolute -top-1 right-[5px] flex h-5 w-5 items-center justify-center"
				aria-label={olderCount > 0 ? `Load ${olderCount} older turns` : "Load older turns"}
				onclick={() => onLoadOlder?.()}
			>
				<span class="absolute h-4 w-1 rounded-full bg-gradient-to-b from-text-placeholder/55 to-transparent opacity-70 transition-opacity group-hover:opacity-100"></span>
				{#if loadingOlder}
					<Loader2 class="absolute h-3 w-3 animate-spin text-text-tertiary" />
				{:else}
					<span class="absolute -top-0.5 h-1 w-1 rounded-full bg-text-placeholder/70"></span>
					<span class="absolute top-1 h-1 w-1 rounded-full bg-text-placeholder/45"></span>
					<span class="absolute top-2.5 h-1 w-1 rounded-full bg-text-placeholder/25"></span>
				{/if}
				<span class="pointer-events-none absolute right-7 hidden whitespace-nowrap rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-tertiary shadow-[0_6px_20px_rgba(0,0,0,0.18)] group-hover:block">
					{countLabel(olderCount)} older unloaded
				</span>
			</button>
		{/if}
		{#each markers as marker (marker.turn.id)}
			<button
				type="button"
				class="group pointer-events-auto absolute right-[7px] flex h-4 w-4 -translate-y-1/2 items-center justify-center"
				style:top={`${marker.top}%`}
				aria-label={`Jump to turn ${marker.turn.sequence}`}
				onmouseenter={() => { hovered = marker; }}
				onmouseleave={() => { hovered = null; }}
				onfocus={() => { hovered = marker; }}
				onblur={() => { hovered = null; }}
				onclick={() => onJump?.(marker.turn.sequence)}
			>
				<span
					class={`block rounded-full transition-all duration-150 ${statusClass(marker.turn.status)} ${marker.loaded ? 'opacity-80' : 'opacity-30'} ${marker.current ? 'h-2.5 w-2.5 bg-brand opacity-100' : 'h-1.5 w-1.5 group-hover:h-2 group-hover:w-2 group-hover:opacity-100'}`}
				></span>
				{#if loadingSequence === marker.turn.sequence}
					<Loader2 class="absolute h-3 w-3 animate-spin text-brand" />
				{/if}
			</button>
		{/each}
		{#if hasMoreNewer || newerCount > 0}
			<button
				type="button"
				class="group pointer-events-auto absolute -bottom-1 right-[5px] flex h-5 w-5 items-center justify-center"
				aria-label={newerCount > 0 ? `Load ${newerCount} newer turns` : "Load newer turns"}
				onclick={() => onLoadNewer?.()}
			>
				<span class="absolute h-4 w-1 rounded-full bg-gradient-to-t from-text-placeholder/55 to-transparent opacity-70 transition-opacity group-hover:opacity-100"></span>
				<span class="absolute -bottom-0.5 h-1 w-1 rounded-full bg-text-placeholder/70"></span>
				<span class="absolute bottom-1 h-1 w-1 rounded-full bg-text-placeholder/45"></span>
				<span class="absolute bottom-2.5 h-1 w-1 rounded-full bg-text-placeholder/25"></span>
				<span class="pointer-events-none absolute right-7 hidden whitespace-nowrap rounded-md border border-border-subtle bg-bg-primary px-2 py-1 text-[10px] text-text-tertiary shadow-[0_6px_20px_rgba(0,0,0,0.18)] group-hover:block">
					{countLabel(newerCount)} newer unloaded
				</span>
			</button>
		{/if}
		{#if hovered}
			<div
				class="pointer-events-none absolute right-8 w-72 -translate-y-1/2 rounded-md border border-border-subtle bg-bg-primary px-3 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.22)]"
				style:top={`${Math.min(96, Math.max(4, hovered.top))}%`}
			>
				<div class="flex items-center justify-between gap-3">
					<div class="text-[11px] font-medium text-text-primary">{turnLabel(hovered.turn)}</div>
					<div class="text-[10px] uppercase tracking-wide text-text-placeholder">{hovered.loaded ? 'loaded' : 'indexed'}</div>
				</div>
				<div class="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-secondary">
					{hovered.turn.userPreview ?? "Empty user message"}
				</div>
				<div class="mt-1.5 truncate text-[10px] text-text-tertiary">{metaLabel(hovered.turn)}</div>
			</div>
		{/if}
	</div>
{/if}
