<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { onDestroy, untrack } from "svelte";
import MarkdownSurface from "$lib/components/MarkdownSurface.svelte";
import StreamingWords from "$lib/components/StreamingWords.svelte";
import { renderMarkdown } from "$lib/markdown";
import { StreamingMarkdownController } from "$lib/streaming-markdown-controller";

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

let stableHtml = $state("");
let tailSource = $state("");
let renderSeq = 0;
let controller: StreamingMarkdownController | null = null;
let unsubscribeController: (() => void) | null = null;

const source = $derived.by(() => {
	const raw =
		sourceProp ?? blocks?.map((block) => block.text).join("\n\n") ?? "";
	return isStreaming ? raw : raw.trim();
});

function ensureController() {
	if (controller) return controller;
	controller = new StreamingMarkdownController();
	unsubscribeController = controller.subscribe((snapshot) => {
		stableHtml = snapshot.stableHtml;
		tailSource = snapshot.tailSource;
		requestAnimationFrame(() => untrack(() => onRendered?.()));
	});
	return controller;
}

function destroyController() {
	unsubscribeController?.();
	unsubscribeController = null;
	controller?.dispose();
	controller = null;
}

function renderFullMarkdown(markdownSource: string) {
	const seq = ++renderSeq;
	untrack(() => onStart?.());
	void renderMarkdown(markdownSource)
		.then((html) => {
			if (seq !== renderSeq) return;
			stableHtml = html;
			tailSource = "";
			requestAnimationFrame(() => {
				if (seq === renderSeq) untrack(() => onRendered?.());
			});
		})
		.catch(() => {
			if (seq !== renderSeq) return;
			requestAnimationFrame(() => untrack(() => onRendered?.()));
		});
}

$effect(() => {
	const markdownSource = source;
	const streaming = isStreaming;

	if (streaming) {
		untrack(() => onStart?.());
		ensureController().setTarget(markdownSource);
		return;
	}

	destroyController();
	renderFullMarkdown(markdownSource);
});

onDestroy(() => {
	destroyController();
});
</script>

<div class="streaming-markdown-flow" class:is-streaming={isStreaming && tailSource.length > 0}>
	<MarkdownSurface html={stableHtml} {variant} />
	{#if isStreaming && tailSource.length > 0}
		<div class="markdown-content streaming-tail-surface" data-variant={variant}>
			<StreamingWords text={tailSource} active={isStreaming} />
		</div>
	{/if}
</div>
