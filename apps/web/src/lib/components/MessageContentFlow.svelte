<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import AttachmentBlocks from "$lib/components/TextAttachmentBlocks.svelte";
import ThinkingBlocks from "$lib/components/ThinkingBlocks.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";

type TextBlock = Extract<ContentBlock, { type: "text" }>;
type ThinkingBlock = Extract<ContentBlock, { type: "thinking" }>;
type ImageBlock = Extract<ContentBlock, { type: "image" }>;
type ShellCommandBlock = Extract<ContentBlock, { type: "shell_command" }>;
type AttachmentBlock = TextBlock | ImageBlock;

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
	| { type: "text"; blocks: TextBlock[] }
	| { type: "thinking"; blocks: ThinkingBlock[] }
	| { type: "image"; blocks: ImageBlock[] }
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

function isTextAttachment(block: TextBlock) {
	return block._meta?.attachmentKind === "text";
}

const userTextBlocks = $derived(
	content.filter(
		(block): block is TextBlock =>
			block.type === "text" && !isTextAttachment(block),
	),
);

const userAttachmentBlocks = $derived(
	content.filter(
		(block): block is AttachmentBlock =>
			block.type === "image" ||
			(block.type === "text" && block._meta?.attachmentKind === "text"),
	),
);

const userShellCommandBlocks = $derived(
	content.filter(
		(block): block is ShellCommandBlock => block.type === "shell_command",
	),
);

const segments = $derived.by(() => {
	const result: Segment[] = [];
	let i = 0;
	while (i < content.length) {
		const block = content[i];
		if (block.type === "text") {
			const blocks: TextBlock[] = [];
			while (content[i]?.type === "text") {
				blocks.push(content[i] as TextBlock);
				i += 1;
			}
			result.push({ type: "text", blocks });
			continue;
		}
		if (block.type === "thinking") {
			const blocks: ThinkingBlock[] = [];
			while (content[i]?.type === "thinking") {
				blocks.push(content[i] as ThinkingBlock);
				i += 1;
			}
			result.push({ type: "thinking", blocks });
			continue;
		}
		if (block.type === "image") {
			const blocks: ImageBlock[] = [];
			while (content[i]?.type === "image") {
				blocks.push(content[i] as ImageBlock);
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

{#if isUserMessage}
	{#if userShellCommandBlocks.length > 0}
		<div class="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-inherit">
			{userShellCommandBlocks.map((block) => ["$", block.command].join("")).join('\n')}
		</div>
	{/if}
	{#if userTextBlocks.length > 0}
		<div class="whitespace-pre-wrap break-words text-inherit" class:mt-2={userShellCommandBlocks.length > 0}>
			{userTextBlocks.map((block) => block.text).join('\n\n')}
		</div>
	{/if}
	{#if userAttachmentBlocks.length > 0}
		<div class={userTextBlocks.length > 0 ? "mt-2" : ""}>
			<AttachmentBlocks blocks={userAttachmentBlocks} />
		</div>
	{/if}
{:else}
	{#each segments as segment, index (`${segment.type}:${index}`)}
		<div class={index === 0 ? "" : "mt-2"}>
			{#if segment.type === 'text'}
				<MarkdownView blocks={segment.blocks} variant="chat" {isStreaming} onStart={onMarkdownSegmentStart} onRendered={onMarkdownSegmentRendered} />
			{:else if segment.type === 'thinking'}
				<ThinkingBlocks blocks={segment.blocks} expanded={thinkingExpanded} {isStreaming} onToggle={onToggleThinking} />
			{:else if segment.type === 'image'}
				<AttachmentBlocks blocks={segment.blocks} />
			{:else if segment.type === 'tool' && showToolCalls}
				<ToolCallList content={segment.blocks} {onLoadToolCalls} flush {onOpenFile} />
			{/if}
		</div>
	{/each}
{/if}
