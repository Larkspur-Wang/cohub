<script lang="ts">
import type { ContentBlock } from "@cohub/protocol/core";
import type { MessageToolCallsFile } from "@cohub/protocol/model";
import { page } from "$app/state";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import AttachmentBlocks from "$lib/components/TextAttachmentBlocks.svelte";
import ThinkingBlocks from "$lib/components/ThinkingBlocks.svelte";
import ToolCallList from "$lib/components/ToolCallList.svelte";
import {
	type SpaceMentionTextToken,
	tokenizeSpaceMentionText,
} from "$lib/mentions/space";

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

type SpaceMentionToken = Extract<
	SpaceMentionTextToken,
	{ type: "spaceMention" }
>;

type UserTextToken =
	| { type: "text"; text: string }
	| {
			type: "spaceMention";
			text: string;
			label: string;
			spaceId: string;
			raw: string;
			uri: string;
			href: string;
	  };

const userMentionButtonClass =
	"inline-flex max-w-full translate-y-[-1px] items-baseline rounded-[5px] bg-brand-muted px-1.5 py-0.5 text-[0.92em] font-medium leading-none text-brand-muted-fg ring-1 ring-brand-border/70 transition-colors hover:bg-brand-muted-hover focus:outline-none focus:ring-1 focus:ring-brand";

function buildUserMentionHref(token: SpaceMentionToken) {
	return `${token.href}?from=${encodeURIComponent(page.url.pathname)}`;
}

function openUserMention(token: SpaceMentionToken, event: MouseEvent) {
	event.preventDefault();
	event.stopPropagation();
	window.open(buildUserMentionHref(token), "_blank", "noopener,noreferrer");
}

function tokenizeUserText(value: string) {
	return tokenizeSpaceMentionText(value).map((token) => {
		if (token.type === "spaceMention") {
			return { ...token, text: `@${token.label}` } satisfies UserTextToken;
		}
		return token satisfies UserTextToken;
	});
}

const userTextTokens = $derived.by(() =>
	tokenizeUserText(userTextBlocks.map((block) => block.text).join("\n\n")),
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
		<div class="font-mono text-[14px] leading-[1.7] text-brand/90 tabular-nums">
			{userShellCommandBlocks.map((block) => ["$", block.command].join("")).join('\n')}
		</div>
	{/if}
	{#if userTextBlocks.length > 0}
		<div class="whitespace-pre-wrap break-words text-inherit" class:mt-2={userShellCommandBlocks.length > 0}>
			{#each userTextTokens as token}
				{#if token.type === 'spaceMention'}
					<button
						type="button"
						class={userMentionButtonClass}
						title={`Open ${token.label} in a new window`}
						aria-label={`Open space ${token.label} in a new window`}
						onclick={(event) => openUserMention(token, event)}
					>{token.text}</button>
				{:else}{token.text}{/if}
			{/each}
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
				<ToolCallList content={segment.blocks} streaming={isStreaming} {onLoadToolCalls} flush {onOpenFile} />
			{/if}
		</div>
	{/each}
{/if}
