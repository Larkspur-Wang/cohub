<script lang="ts">
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ToolExecutionCard from "$lib/components/ToolExecutionCard.svelte";
import { Loader2 } from "lucide-svelte";
import type { TimelineItem } from "$lib/session-tree";

type Props = {
	timeline: TimelineItem[];
	bindListEl?: HTMLDivElement | null;
	bindContentEl?: HTMLDivElement | null;
	onScrollChange?: () => void;
	bottomInsetClass?: string;
	/** Number of unseen items at the top before triggering preload */
	preloadThreshold?: number;
	onFirstVisible?: (index: number) => void;
	/** Whether older messages are currently being loaded (scroll-up pagination) */
	loadingOlder?: boolean;
};

let {
	timeline,
	bindListEl = $bindable(null),
	bindContentEl = $bindable(null),
	onScrollChange,
	bottomInsetClass = "pb-[calc(11rem+4.5rem+env(safe-area-inset-bottom))] sm:pb-48",
	preloadThreshold = 10,
	onFirstVisible,
	loadingOlder = false,
}: Props = $props();

// Track all observed elements for re-observation
let observedNodes = new Map<HTMLElement, number>();
let observer: IntersectionObserver | null = null;

// When prepending older messages, preserve scroll position
let prevScrollHeight = $state(0);

export function preparePrepend() {
	if (!bindListEl) return;
	prevScrollHeight = bindListEl.scrollHeight;
}

export function finalizePrepend() {
	if (!bindListEl || prevScrollHeight === 0) return;
	const newScrollHeight = bindListEl.scrollHeight;
	const addedHeight = newScrollHeight - prevScrollHeight;
	if (addedHeight > 0) {
		bindListEl.scrollTop += addedHeight;
	}
	prevScrollHeight = 0;
}

// Svelte action: register element with IntersectionObserver
function observeItem(node: HTMLElement, index: number) {
	observedNodes.set(node, index);
	if (observer) {
		observer.observe(node);
	}
	return {
		destroy() {
			observedNodes.delete(node);
			observer?.unobserve(node);
		},
		update(newIndex: number) {
			observedNodes.set(node, newIndex);
		},
	};
}

// Create observer and observe all registered nodes
$effect(() => {
	// Reference bindListEl to ensure effect runs when it's set
	const _root = bindListEl;

	observer = new IntersectionObserver(
		(entries) => {
			let minIdx = Number.POSITIVE_INFINITY;
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const idx = Number((entry.target as HTMLElement).dataset.idx);
					if (idx < minIdx) minIdx = idx;
				}
			}
			if (minIdx !== Number.POSITIVE_INFINITY) {
				onFirstVisible?.(minIdx);
			}
		},
		{
			root: bindListEl,
			rootMargin: "0px",
			threshold: 0,
		},
	);

	// Observe all previously registered nodes
	for (const [node] of observedNodes) {
		observer.observe(node);
	}

	return () => {
		observer?.disconnect();
		observer = null;
	};
});
</script>

<div
	bind:this={bindListEl}
	class="flex-1 min-h-0 overflow-y-auto bg-bg-content px-3 py-4 sm:px-5"
	onscroll={() => onScrollChange?.()}
>
	<div bind:this={bindContentEl} class={`mx-auto flex w-full max-w-4xl flex-col gap-3 ${bottomInsetClass}`}>
		{#if loadingOlder}
			<div class="flex items-center justify-center gap-1.5 py-3">
				<Loader2 class="w-3.5 h-3.5 animate-spin text-text-tertiary" />
				<span class="text-[12px] text-text-tertiary">Loading messages…</span>
			</div>
		{/if}
		{#each timeline as item, idx (item.id)}
			<div
				data-idx={idx}
				use:observeItem={idx}
			>
				{#if item.kind === 'message'}
					<ChatMessageBubble message={item.message} />
				{:else}
					<ToolExecutionCard tool={item.tool} />
				{/if}
			</div>
		{/each}
	</div>
</div>
