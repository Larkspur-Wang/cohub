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
	currentSequence?: number | null;
	loadingSequence?: number | null;
	onJump?: (sequence: number) => void;
};

let {
	turns,
	loadedTurns = [],
	currentSequence = null,
	loadingSequence = null,
	onJump,
}: Props = $props();

let hovered = $state<Marker | null>(null);

const loadedSequences = $derived(
	new Set(loadedTurns.map((turn) => turn.sequence)),
);
const minSequence = $derived(turns.at(0)?.sequence ?? 0);
const maxSequence = $derived(turns.at(-1)?.sequence ?? minSequence);
const span = $derived(Math.max(1, maxSequence - minSequence));
const effectiveCurrent = $derived.by(() => {
	if (currentSequence != null) return currentSequence;
	return loadedTurns.at(-1)?.sequence ?? null;
});
const markers = $derived.by<Marker[]>(() =>
	turns.map((turn) => ({
		turn,
		top: ((turn.sequence - minSequence) / span) * 100,
		loaded: loadedSequences.has(turn.sequence),
		current: effectiveCurrent === turn.sequence,
	})),
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

{#if markers.length > 1}
	<div class="pointer-events-none absolute inset-y-8 right-1 z-10 hidden w-7 lg:block">
		<div class="absolute right-3 top-0 h-full w-px bg-border-subtle/70"></div>
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
