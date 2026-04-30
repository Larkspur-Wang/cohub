<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { onMount, tick, untrack } from "svelte";
import { mediaLightbox } from "$lib/components/media-lightbox.svelte";
import { renderMarkdown } from "$lib/markdown";

type Props = {
	blocks: Extract<ContentBlock, { type: "text" }>[];
	onStart?: () => void;
	onRendered?: () => void;
};

const { blocks, onStart, onRendered }: Props = $props();
let renderedHtml = $state("");
let markdownEl = $state<HTMLElement | null>(null);
const source = $derived(
	blocks
		.map((block) => block.text)
		.join("\n\n")
		.trim(),
);

$effect(() => {
	const markdownSource = source;
	untrack(() => onStart?.());
	let cancelled = false;
	void renderMarkdown(markdownSource)
		.then(async (html) => {
			if (cancelled) return;
			renderedHtml = html;
			await tick();
			requestAnimationFrame(() => {
				if (!cancelled) untrack(() => onRendered?.());
			});
		})
		.catch(() => untrack(() => onRendered?.()));
	return () => {
		cancelled = true;
		untrack(() => onRendered?.());
	};
});

onMount(() => {
	const el = markdownEl;
	if (!el) return;

	function onClick(e: Event) {
		const target = e.target as HTMLElement;
		if (target.tagName === "IMG") {
			e.preventDefault();
			e.stopPropagation();
			const img = target as HTMLImageElement;
			mediaLightbox.show({
				src: img.src,
				type: "image" as const,
				alt: img.alt,
			});
		} else if (
			target.tagName === "VIDEO" ||
			(target.tagName === "SOURCE" && target.parentElement?.tagName === "VIDEO")
		) {
			e.preventDefault();
			e.stopPropagation();
			const video =
				target.tagName === "VIDEO"
					? (target as HTMLVideoElement)
					: (target.parentElement as HTMLVideoElement);
			mediaLightbox.show({
				src: video.src || (video.querySelector("source")?.src ?? ""),
				type: "video" as const,
			});
		}
	}

	el.addEventListener("click", onClick);
	return () => el.removeEventListener("click", onClick);
});
</script>

<div bind:this={markdownEl} class="prose prose-sm prose-invert max-w-none text-inherit">
	{@html renderedHtml}
</div>
