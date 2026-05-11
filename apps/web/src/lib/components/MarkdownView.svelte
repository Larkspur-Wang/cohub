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

const STREAM_RENDER_INTERVAL = 96;
const STREAM_TEXT_FRAME_MS = 24;
const STREAM_MIN_STEP = 2;
const STREAM_MAX_STEP = 36;
const STREAM_CATCHUP_THRESHOLD = 900;
const STREAM_FLUSH_GAP_MS = 180;

let displayedSource = $state("");
let renderedHtml = $state("");
let renderSeq = 0;
let streamTimer: ReturnType<typeof setTimeout> | null = null;
let streamRaf = 0;
let textTimer: ReturnType<typeof setTimeout> | null = null;
let lastStreamRenderAt = 0;
let lastSourceLength = 0;
let lastSourceChangeAt = 0;

const source = $derived.by(() => {
	const raw =
		sourceProp ?? blocks?.map((block) => block.text).join("\n\n") ?? "";
	return isStreaming ? raw : raw.trim();
});

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

function clearTextTimer() {
	if (textTimer) {
		clearTimeout(textTimer);
		textTimer = null;
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

function visibleStepSize(remaining: number) {
	if (remaining > STREAM_CATCHUP_THRESHOLD) return STREAM_MAX_STEP;
	if (remaining > 360) return 22;
	if (remaining > 140) return 12;
	return STREAM_MIN_STEP + Math.min(8, Math.floor(remaining / 32));
}

function scheduleTextAdvance(targetSource: string) {
	clearTextTimer();
	if (displayedSource === targetSource) return;

	const now = performance.now();
	const shouldFlush = now - lastSourceChangeAt > STREAM_FLUSH_GAP_MS;
	const remaining = targetSource.length - displayedSource.length;

	if (
		shouldFlush ||
		remaining <= 0 ||
		!targetSource.startsWith(displayedSource)
	) {
		displayedSource = targetSource;
		return;
	}

	const step = Math.min(remaining, visibleStepSize(remaining));
	displayedSource = targetSource.slice(0, displayedSource.length + step);
	textTimer = setTimeout(
		() => scheduleTextAdvance(targetSource),
		STREAM_TEXT_FRAME_MS,
	);
}

$effect(() => {
	const markdownSource = source;
	const streaming = isStreaming;

	if (markdownSource.length !== lastSourceLength) {
		lastSourceLength = markdownSource.length;
		lastSourceChangeAt = performance.now();
	}

	if (streaming) {
		scheduleTextAdvance(markdownSource);
	} else {
		clearTextTimer();
		displayedSource = markdownSource;
	}
});

$effect(() => {
	const markdownSource = displayedSource;
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
	clearTextTimer();
});
</script>

<MarkdownSurface html={renderedHtml} {variant} />
