<script lang="ts">
import type { SessionTurnIndexItem } from "@cohub/protocol/model";
import { Search } from "lucide-svelte";

type Props = {
	turns: SessionTurnIndexItem[];
	currentSequence?: number | null;
	hasMoreOlder?: boolean;
	hasMoreNewer?: boolean;
	loadingOlder?: boolean;
	loadingNewer?: boolean;
	onJump?: (sequence: number) => void;
	onLoadOlder?: () => void;
	onLoadNewer?: () => void;
};

let {
	turns,
	currentSequence = null,
	hasMoreOlder = false,
	hasMoreNewer = false,
	loadingOlder = false,
	loadingNewer = false,
	onJump,
	onLoadOlder,
	onLoadNewer,
}: Props = $props();

let query = $state("");
let scrollEl = $state<HTMLDivElement | null>(null);
let lastScrolledSequence: number | null = null;

function normalizedPreview(turn: SessionTurnIndexItem) {
	return turn.userPreview?.trim() || "Empty user message";
}

const filteredTurns = $derived.by(() => {
	const value = query.trim().toLowerCase();
	if (!value) return turns;
	return turns.filter((turn) => {
		if (`#${turn.sequence}`.includes(value)) return true;
		if (String(turn.sequence).includes(value)) return true;
		return normalizedPreview(turn).toLowerCase().includes(value);
	});
});

$effect(() => {
	if (!scrollEl || currentSequence == null) return;
	if (lastScrolledSequence === currentSequence) return;
	lastScrolledSequence = currentSequence;
	const item = scrollEl.querySelector<HTMLElement>(
		`[data-turn-sequence="${currentSequence}"]`,
	);
	item?.scrollIntoView({ block: "nearest" });
});
</script>

<div
	class="turn-navigator-panel flex w-[min(420px,calc(100vw-72px))] max-h-[min(680px,72vh)] flex-col overflow-hidden rounded-lg border border-border-subtle bg-bg-primary shadow-xl shadow-bg-primary/20"
	role="dialog"
	aria-label="Turns"
>
	<div class="shrink-0 border-b border-border-subtle/70 px-2 py-2">
		<label class="flex h-8 items-center gap-2 rounded-md border border-border-subtle bg-bg-input px-2 text-text-placeholder transition-colors duration-150 focus-within:border-border-strong focus-within:text-text-tertiary">
			<Search class="h-3.5 w-3.5 shrink-0" />
			<input
				bind:value={query}
				type="search"
				class="min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none placeholder:text-text-placeholder"
				placeholder="Search turns"
				aria-label="Search turns"
			/>
		</label>
	</div>

	<div bind:this={scrollEl} class="min-h-0 flex-1 scroll-py-2 overflow-y-auto overscroll-contain px-2 py-2">
		{#if hasMoreOlder || loadingOlder}
			<button
				type="button"
				class="mb-1 flex h-8 w-full items-center justify-center rounded-md text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-default disabled:opacity-60"
				disabled={loadingOlder}
				onclick={() => onLoadOlder?.()}
			>
				{loadingOlder ? "Loading…" : "Load older"}
			</button>
		{/if}

		{#if filteredTurns.length === 0}
			<div class="flex min-h-28 items-center justify-center text-[12px] text-text-placeholder">No turns found</div>
		{:else}
			<div class="space-y-1">
				{#each filteredTurns as turn (turn.id)}
					<button
						type="button"
						data-turn-sequence={turn.sequence}
						class={`group/sidebar-flyout-item sidebar-flyout-item flex w-full gap-1.5 rounded-md px-2 py-2 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-brand/35 ${currentSequence === turn.sequence ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
						onclick={() => onJump?.(turn.sequence)}
					>
						<span class={`mt-0.5 w-7 shrink-0 font-mono text-[11px] leading-5 ${currentSequence === turn.sequence ? 'text-brand' : 'text-text-placeholder group-hover/sidebar-flyout-item:text-text-tertiary'}`}>#{turn.sequence}</span>
						<span class="line-clamp-4 min-w-0 flex-1 text-[12px] leading-relaxed tracking-[-0.01em]">
							{normalizedPreview(turn)}
						</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if hasMoreNewer || loadingNewer}
			<button
				type="button"
				class="mt-1 flex h-8 w-full items-center justify-center rounded-md text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:cursor-default disabled:opacity-60"
				disabled={loadingNewer}
				onclick={() => onLoadNewer?.()}
			>
				{loadingNewer ? "Loading…" : "Load newer"}
			</button>
		{/if}
	</div>
</div>

<style>
	@media (prefers-reduced-motion: no-preference) {
		.turn-navigator-panel {
			animation: turn-navigator-enter 120ms cubic-bezier(0.16, 1, 0.3, 1);
			transform-origin: right top;
		}
	}

	@keyframes turn-navigator-enter {
		from {
			opacity: 0;
			transform: translate3d(4px, 0, 0) scale(0.985);
		}

		to {
			opacity: 1;
			transform: translate3d(0, 0, 0) scale(1);
		}
	}
</style>
