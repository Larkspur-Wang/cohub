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
let renderSeq = 0;
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
const source = $derived(
	blocks
		.map((block) => block.text)
		.join("\n\n")
		.trim(),
);

$effect(() => {
	const markdownSource = source;
	const seq = ++renderSeq;
	untrack(() => onStart?.());
	void renderMarkdown(markdownSource)
		.then(async (html) => {
			if (seq !== renderSeq) return;
			renderedHtml = html;
			await tick();
			if (seq === renderSeq) enhanceCodeBlocks();
			requestAnimationFrame(() => {
				if (seq === renderSeq) untrack(() => onRendered?.());
			});
		})
		.catch(() => {
			if (seq === renderSeq) untrack(() => onRendered?.());
		});
});

function enhanceCodeBlocks() {
	if (!markdownEl) return;

	for (const pre of markdownEl.querySelectorAll("pre")) {
		if (pre.parentElement?.classList.contains("markdown-code-block")) continue;

		const wrapper = document.createElement("div");
		wrapper.className = "markdown-code-block";
		pre.parentNode?.insertBefore(wrapper, pre);
		wrapper.appendChild(pre);

		const button = document.createElement("button");
		button.type = "button";
		button.className = "markdown-code-copy";
		button.dataset.codeCopy = "";
		button.textContent = "⧉";
		button.setAttribute("aria-label", "Copy code");
		button.title = "Copy code";
		wrapper.appendChild(button);
	}
}

async function copyText(text: string) {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textArea = document.createElement("textarea");
	textArea.value = text;
	textArea.style.position = "fixed";
	textArea.style.opacity = "0";
	document.body.appendChild(textArea);
	textArea.select();
	document.execCommand("copy");
	textArea.remove();
}

function markCopied(button: HTMLButtonElement) {
	button.textContent = "✓";
	button.classList.add("copied");
	button.setAttribute("aria-label", "Code copied");
	button.title = "Code copied";
	if (copyResetTimer) clearTimeout(copyResetTimer);
	copyResetTimer = setTimeout(() => {
		button.textContent = "⧉";
		button.classList.remove("copied");
		button.setAttribute("aria-label", "Copy code");
		button.title = "Copy code";
	}, 1400);
}

onMount(() => {
	const el = markdownEl;
	if (!el) return;

	function onClick(e: Event) {
		const target = e.target as HTMLElement;
		const copyButton = target.closest<HTMLButtonElement>("[data-code-copy]");
		if (copyButton) {
			e.preventDefault();
			e.stopPropagation();
			const code = copyButton.parentElement?.querySelector("pre code");
			void copyText(code?.textContent ?? "").then(() => markCopied(copyButton));
			return;
		}

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
	return () => {
		el.removeEventListener("click", onClick);
		if (copyResetTimer) clearTimeout(copyResetTimer);
	};
});
</script>

<div bind:this={markdownEl} class="prose prose-sm prose-invert max-w-none text-inherit">
	{@html renderedHtml}
</div>
