<script lang="ts">
import { Loader2 } from "lucide-svelte";
import type { TimelineItem } from "$lib/session-tree";

type Props = {
	timeline: TimelineItem[];
	bindListEl?: HTMLDivElement | null;
	/** Number of unseen items at the visual top before triggering preload */
	preloadThreshold?: number;
	onFirstVisible?: (index: number) => void;
	/** Whether older messages are currently being loaded (scroll-up pagination) */
	loadingOlder?: boolean;
};

let {
	timeline,
	bindListEl = $bindable(null),
	preloadThreshold = 10,
	onFirstVisible,
	loadingOlder = false,
}: Props = $props();

// Track all observed elements for re-observation.
let observedNodes = new Map<HTMLElement, number>();
let observer: IntersectionObserver | null = null;

// Scroll-up pagination: old messages are prepended to DOM top.
// We save/restore scrollTop to prevent the view from jumping.
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
function _observeItem(node: HTMLElement, originalIndex: number) {
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
	<div class={`mx-auto max-w-4xl flex flex-col [&>*]:mt-2 pt-6 pb-[8rem]`}>
		{#each timeline as item, idx (item.id)}
			{@const originalIdx = idx}
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
	/* Uniform spacing between items via gap on the parent flex container.
	 * The previous column-reverse + :has() approach was fragile and hard to
	 * reason about — a single gap value is cleaner and predictable.
	 */
</style>
