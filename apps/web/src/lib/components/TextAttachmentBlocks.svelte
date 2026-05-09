<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { ArrowUpRight, FileText } from "lucide-svelte";
import Dialog from "$lib/components/Dialog.svelte";

type TextBlock = Extract<ContentBlock, { type: "text" }>;

type Props = {
	blocks: TextBlock[];
};

const { blocks }: Props = $props();

let previewBlock = $state<{ block: TextBlock; index: number } | null>(null);

function isTextAttachment(block: TextBlock) {
	return block._meta?.attachmentKind === "text";
}

function getFilename(block: TextBlock, index: number) {
	return String(block._meta?.filename ?? `attachment-${index + 1}.txt`);
}

function getSizeLabel(block: TextBlock) {
	const size = block._meta?.size;
	if (typeof size !== "number" || !Number.isFinite(size)) return "Text file";
	return `${Math.ceil(size / 1024)} KB`;
}

function getAttachmentBody(block: TextBlock) {
	const filename = block._meta?.filename;
	if (typeof filename !== "string" || !filename) return block.text;
	const prefix = `[File: ${filename}]\n`;
	return block.text.startsWith(prefix)
		? block.text.slice(prefix.length)
		: block.text;
}
</script>

<div class="space-y-2">
	{#each blocks as block, index}
		{#if isTextAttachment(block)}
			<button
				type="button"
				class="group flex w-fit items-center gap-2 rounded-xl border border-border-subtle bg-bg-content/60 px-2.5 py-1.5 text-left transition-colors hover:border-border-strong hover:bg-bg-content"
				onclick={() => {
					previewBlock = { block, index };
				}}
				title="Preview file"
				aria-label={`Preview ${getFilename(block, index)}`}
			>
				<div class="flex h-6 w-6 items-center justify-center text-text-tertiary">
					<FileText class="h-3.5 w-3.5" />
				</div>
				<div class="min-w-0">
					<div class="truncate text-[12px] font-medium leading-4 text-text-primary" title={getFilename(block, index)}>{getFilename(block, index)}</div>
					<div class="text-[10px] leading-3 text-text-tertiary">{getSizeLabel(block)}</div>
				</div>
				<ArrowUpRight class="h-3 w-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
			</button>
		{:else}
			<div class="whitespace-pre-wrap break-words text-inherit">
				{block.text}
			</div>
		{/if}
	{/each}
</div>

<Dialog
	open={previewBlock !== null}
	onClose={() => {
		previewBlock = null;
	}}
	title={previewBlock ? getFilename(previewBlock.block, previewBlock.index) : "File preview"}
	maxWidth="860px"
>
	{#if previewBlock}
		<div class="border-b border-border-subtle px-3 py-2 text-[11px] text-text-tertiary">
			{getSizeLabel(previewBlock.block)}
		</div>
		<pre class="max-h-[62vh] overflow-auto whitespace-pre-wrap break-words bg-bg-content px-4 py-3 text-[12px] leading-5 text-text-secondary"><code>{getAttachmentBody(previewBlock.block)}</code></pre>
	{/if}
</Dialog>
