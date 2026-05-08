<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { untrack } from "svelte";
import MarkdownSurface from "$lib/components/MarkdownSurface.svelte";
import { renderMarkdown } from "$lib/markdown";

type MarkdownTextBlock = Extract<ContentBlock, { type: "text" }>;
type MarkdownVariant = "chat" | "document";

type Props = {
	source?: string;
	blocks?: MarkdownTextBlock[];
	variant?: MarkdownVariant;
	onStart?: () => void;
	onRendered?: () => void;
};

const {
	source: sourceProp,
	blocks,
	variant = "chat",
	onStart,
	onRendered,
}: Props = $props();

let renderedHtml = $state("");
let renderSeq = 0;

const source = $derived(
	(sourceProp ?? blocks?.map((block) => block.text).join("\n\n") ?? "").trim(),
);

$effect(() => {
	const markdownSource = source;
	const seq = ++renderSeq;
	untrack(() => onStart?.());
	void renderMarkdown(markdownSource)
		.then((html) => {
			if (seq !== renderSeq) return;
			renderedHtml = html;
			requestAnimationFrame(() => {
				if (seq === renderSeq) untrack(() => onRendered?.());
			});
		})
		.catch(() => {
			if (seq === renderSeq) untrack(() => onRendered?.());
		});
});
</script>

<MarkdownSurface html={renderedHtml} {variant} />
