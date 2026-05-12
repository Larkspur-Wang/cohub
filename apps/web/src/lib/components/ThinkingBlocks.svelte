<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import StreamingWords from "$lib/components/StreamingWords.svelte";

type Props = {
	blocks: Extract<ContentBlock, { type: "thinking" }>[];
	expanded: boolean;
	isStreaming?: boolean;
	onToggle?: () => void;
};

const { blocks, expanded, isStreaming = false, onToggle }: Props = $props();
const THINKING_COLLAPSE_CHARS = 260;
const content = $derived(
	blocks
		.map((block) => block.thinking)
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim(),
);
const needsTruncation = $derived(
	content.length > THINKING_COLLAPSE_CHARS ||
		blocks.some((block) => block._meta?.truncated === true),
);
const display = $derived.by(() => {
	if (expanded || !needsTruncation) return content;
	const truncated = content.slice(0, THINKING_COLLAPSE_CHARS);
	const lastNewline = truncated.lastIndexOf("\n");
	return lastNewline > THINKING_COLLAPSE_CHARS * 0.5
		? truncated.slice(0, lastNewline)
		: `${truncated}…`;
});
</script>

{#if content}
	<div>
		<div class="text-[13px] leading-snug text-text-disabled break-words font-sans whitespace-pre-wrap">
			{#if isStreaming}
				<StreamingWords text={display} active={isStreaming} tone="muted" />
			{:else}
				{display}
			{/if}
		</div>
		{#if !isStreaming && needsTruncation}
			<button
				type="button"
				class="mt-1 inline-flex items-center gap-1 text-[11px] text-text-placeholder hover:text-text-tertiary cursor-pointer"
				onclick={onToggle}
			>
				<span>{expanded ? 'Show less' : '… more'}</span>
			</button>
		{/if}
	</div>
{/if}
