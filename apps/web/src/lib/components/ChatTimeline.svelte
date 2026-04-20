<script lang="ts">
import ChatMessageBubble from "$lib/components/ChatMessageBubble.svelte";
import ProcessCard from "$lib/components/ProcessCard.svelte";
import ToolExecutionCard from "$lib/components/ToolExecutionCard.svelte";
import { Loader2 } from "lucide-svelte";
import type { TimelineItem } from "$lib/session-tree";

type Props = {
	timeline: TimelineItem[];
	bindListEl?: HTMLDivElement | null;
	/** Padding at visual bottom (DOM start in column-reverse). Default accounts for the composer input. */
	topInsetClass?: string;
	/** Number of unseen items at the visual top before triggering preload */
	preloadThreshold?: number;
	onFirstVisible?: (index: number) => void;
	/** Whether older messages are currently being loaded (scroll-up pagination) */
	loadingOlder?: boolean;
};

let {
	timeline,
	bindListEl = $bindable(null),
	topInsetClass = "pt-[calc(4rem+env(safe-area-inset-bottom))] sm:pt-[4rem]",
	preloadThreshold = 10,
	onFirstVisible,
	loadingOlder = false,
}: Props = $props();

// column-reverse: reverse the DOM order so newest messages are at the DOM start
// (visual bottom). This lets CSS scroll anchoring automatically keep the view
// pinned to the bottom as new content arrives — no manual scrollTop math needed.
//
// Performance: reversal is O(n) but for chat lists (typically <1000 items) it's
// <0.1ms. The keyed {#each} diff only touches items that actually changed.
const reversedTimeline = $derived([...timeline].reverse());

// Track all observed elements for re-observation.
// We store the _original_ timeline index so onFirstVisible receives the same
// semantics as before (0 = oldest message at visual top).
let observedNodes = new Map<HTMLElement, number>();
let observer: IntersectionObserver | null = null;

// With column-reverse, new messages are added at the DOM START (visual bottom)
// where scroll anchoring works well. However, old messages loaded via pagination
// are added at the DOM END (visual top) — the far end of the scroll container
// — so scroll anchoring does NOT help. We need manual scroll compensation.
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
function observeItem(node: HTMLElement, originalIndex: number) {
	observedNodes.set(node, originalIndex);
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
	class="flex-1 min-h-0 overflow-y-auto bg-bg-content px-4 sm:px-6"
>
	<div class={`mx-auto max-w-4xl flex flex-col-reverse [&>*]:mt-2 pb-4 sm:pb-5 pt-8`}>
		{#each reversedTimeline as item, idx (item.id)}
			{@const originalIdx = timeline.length - 1 - idx}
			<div
				data-idx={originalIdx}
				data-kind={item.kind}
				use:observeItem={originalIdx}
			>
				{#if item.kind === 'message'}
					<ChatMessageBubble message={item.message} />
				{:else if item.kind === 'process'}
					<ProcessCard messages={item.messages} />
				{:else}
					<ToolExecutionCard tool={item.tool} />
				{/if}
			</div>
		{/each}
		{#if loadingOlder}
			<div class="flex items-center justify-center gap-1.5 py-3">
				<Loader2 class="w-3.5 h-3.5 animate-spin text-text-tertiary" />
				<span class="text-[12px] text-text-tertiary">Loading messages…</span>
			</div>
		{/if}
	</div>
</div>

<style>
	/* In column-reverse the DOM order is newest→oldest (bottom→top visually).
	 * The + selector matches DOM-next-sibling = visually-above.
	 * Remove top margin from items that sit directly above certain types.
	 */
	/* Tool card immediately below a message (message is DOM-next = visually above tool) */
	:global([data-kind="tool"]:has(+ [data-kind="message"])) {
		margin-top: 0 !important;
	}
	/* Tool card immediately below another tool */
	:global([data-kind="tool"]:has(+ [data-kind="tool"])) {
		margin-top: 0 !important;
	}
	/* Process card immediately below a message */
	:global([data-kind="process"]:has(+ [data-kind="message"])) {
		margin-top: 0 !important;
	}
	/* Message immediately below a process card */
	:global([data-kind="message"]:has(+ [data-kind="process"])) {
		margin-top: 0 !important;
	}
</style>
