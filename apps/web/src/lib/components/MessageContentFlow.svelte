<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import ImageBlocks from "$lib/components/ImageBlocks.svelte";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import ThinkingBlocks from "$lib/components/ThinkingBlocks.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";

type Props = {
	content: ContentBlock[];
	isUserMessage?: boolean;
	thinkingExpanded: boolean;
	isStreaming?: boolean;
	showToolCalls?: boolean;
	onToggleThinking?: () => void;
	onMarkdownSegmentRendered?: () => void;
	onMarkdownSegmentStart?: () => void;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
	onOpenFile?: (path: string) => void;
};

type Segment =
	| { type: "text"; blocks: Extract<ContentBlock, { type: "text" }>[] }
	| { type: "thinking"; blocks: Extract<ContentBlock, { type: "thinking" }>[] }
	| { type: "image"; blocks: Extract<ContentBlock, { type: "image" }>[] }
	| { type: "tool"; blocks: ContentBlock[] };

const {
	content,
	isUserMessage = false,
	thinkingExpanded,
	isStreaming = false,
	showToolCalls = true,
	onToggleThinking,
	onMarkdownSegmentRendered,
	onMarkdownSegmentStart,
	onLoadToolCalls,
	onOpenFile,
}: Props = $props();

const segments = $derived.by(() => {
	const result: Segment[] = [];
	let i = 0;
	while (i < content.length) {
		const block = content[i];
		if (block.type === "text") {
			const blocks: Extract<ContentBlock, { type: "text" }>[] = [];
			while (content[i]?.type === "text") {
				blocks.push(content[i] as Extract<ContentBlock, { type: "text" }>);
				i += 1;
			}
			result.push({ type: "text", blocks });
			continue;
		}
		if (block.type === "thinking") {
			const blocks: Extract<ContentBlock, { type: "thinking" }>[] = [];
			while (content[i]?.type === "thinking") {
				blocks.push(content[i] as Extract<ContentBlock, { type: "thinking" }>);
				i += 1;
			}
			result.push({ type: "thinking", blocks });
			continue;
		}
		if (block.type === "image") {
			const blocks: Extract<ContentBlock, { type: "image" }>[] = [];
			while (content[i]?.type === "image") {
				blocks.push(content[i] as Extract<ContentBlock, { type: "image" }>);
				i += 1;
			}
			result.push({ type: "image", blocks });
			continue;
		}
		if (block.type === "tool_use") {
			const blocks: ContentBlock[] = [block];
			const next = content[i + 1];
			if (next?.type === "tool_result" && next.tool_use_id === block.id) {
				blocks.push(next);
				i += 2;
			} else {
				i += 1;
			}
			result.push({ type: "tool", blocks });
			continue;
		}
		// tool_result without a directly preceding tool_use is skipped here to avoid
		// rendering orphaned result blocks out of context.
		i += 1;
	}
	return result;
});
</script>

{#each segments as segment, index (`${segment.type}:${index}`)}
	<div class={index === 0 ? "" : "mt-2"}>
		{#if segment.type === 'text'}
			{#if isUserMessage}
				<div class="whitespace-pre-wrap break-words text-inherit">
					{segment.blocks.map((block) => block.text).join('\n\n')}
				</div>
			{:else}
				<MarkdownView blocks={segment.blocks} variant="chat" onStart={onMarkdownSegmentStart} onRendered={onMarkdownSegmentRendered} />
			{/if}
		{:else if segment.type === 'thinking'}
			<ThinkingBlocks blocks={segment.blocks} expanded={thinkingExpanded} {isStreaming} onToggle={onToggleThinking} />
		{:else if segment.type === 'image'}
			<ImageBlocks blocks={segment.blocks} />
		{:else if segment.type === 'tool' && showToolCalls}
			<ToolCallList content={segment.blocks} {onLoadToolCalls} flush {onOpenFile} />
		{/if}
	</div>
{/each}
