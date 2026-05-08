<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { onDestroy, untrack } from "svelte";
import MarkdownSurface from "$lib/components/MarkdownSurface.svelte";
import { renderMarkdown, renderStreamingMarkdown } from "$lib/markdown";

type MarkdownTextBlock = Extract<ContentBlock, { type: "text" }>;
type MarkdownVariant = "chat" | "document";

type Props = {
	source?: string;
	blocks?: MarkdownTextBlock[];
	variant?: MarkdownVariant;
	isStreaming?: boolean;
	onStart?: () => void;
	onRendered?: () => void;
};

const {
	source: sourceProp,
	blocks,
	variant = "chat",
	isStreaming = false,
	onStart,
	onRendered,
}: Props = $props();

const STREAM_RENDER_INTERVAL = 64;

let renderedHtml = $state("");
let renderSeq = 0;
let streamTimer: ReturnType<typeof setTimeout> | null = null;
let streamRaf = 0;
let lastStreamRenderAt = 0;

const source = $derived(
	(sourceProp ?? blocks?.map((block) => block.text).join("\n\n") ?? "").trim(),
);

function clearScheduledStreamRender() {
	if (streamTimer) {
		clearTimeout(streamTimer);
		streamTimer = null;
	}
	if (streamRaf) {
		cancelAnimationFrame(streamRaf);
		streamRaf = 0;
	}
}

function markRendered(seq: number) {
	requestAnimationFrame(() => {
		if (seq === renderSeq) untrack(() => onRendered?.());
	});
}

function renderNow(markdownSource: string, streaming: boolean) {
	const seq = ++renderSeq;
	untrack(() => onStart?.());
	const renderer = streaming ? renderStreamingMarkdown : renderMarkdown;

	void renderer(markdownSource)
		.then((html) => {
			if (seq !== renderSeq) return;
			renderedHtml = html;
			markRendered(seq);
		})
		.catch(() => {
			if (seq === renderSeq) markRendered(seq);
		});
}

function scheduleStreamingRender(markdownSource: string) {
	clearScheduledStreamRender();
	const now = performance.now();
	const delay = Math.max(
		0,
		STREAM_RENDER_INTERVAL - (now - lastStreamRenderAt),
	);

	streamTimer = setTimeout(() => {
		streamTimer = null;
		streamRaf = requestAnimationFrame(() => {
			streamRaf = 0;
			lastStreamRenderAt = performance.now();
			renderNow(markdownSource, true);
		});
	}, delay);
}

$effect(() => {
	const markdownSource = source;
	const streaming = isStreaming;

	if (streaming) {
		scheduleStreamingRender(markdownSource);
	} else {
		clearScheduledStreamRender();
		renderNow(markdownSource, false);
	}
});

onDestroy(() => {
	clearScheduledStreamRender();
});
</script>

<MarkdownSurface html={renderedHtml} {variant} />
