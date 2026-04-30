<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-svelte";

type Props = {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
};

const { content, toolCallsFile = null, onLoadToolCalls }: Props = $props();
let expandedToolCalls = $state<Set<string>>(new Set());
let loading = $state(false);
let loadError = $state<string | null>(null);
let loadedFile = $state<MessageToolCallsFile | null>(null);

const effectiveFile = $derived(toolCallsFile ?? loadedFile);
const toolUseBlocks = $derived(
	content.filter((block) => block.type === "tool_use"),
);

function summarizeToolInput(
	name: string,
	input?: Record<string, unknown>,
): string {
	if (!input) return "";
	const command = input.command;
	if (name === "bash") {
		if (typeof command === "string") return `$ ${command}`;
		if (command && typeof command === "object" && "preview" in command)
			return `$ ${String((command as { preview?: unknown }).preview ?? "")}`;
	}
	if (
		["read", "write", "edit"].includes(name) &&
		typeof input.path === "string"
	)
		return input.path;
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

function findToolResult(toolUseId: string): ContentBlock | undefined {
	return content.find(
		(block) => block.type === "tool_result" && block.tool_use_id === toolUseId,
	);
}

function getToolStatus(
	toolUse: Extract<ContentBlock, { type: "tool_use" }>,
): "done" | "failed" | "running" {
	const metaStatus = toolUse._meta?.toolStatus;
	if (
		metaStatus === "done" ||
		metaStatus === "failed" ||
		metaStatus === "running"
	)
		return metaStatus;
	const result = findToolResult(toolUse.id);
	if (!result) return "running";
	return result.type === "tool_result" && result.is_error ? "failed" : "done";
}

function getFullTool(toolUseId: string) {
	return effectiveFile?.toolCalls.find((tool) => tool.id === toolUseId) ?? null;
}

async function toggleToolCall(id: string) {
	const opening = !expandedToolCalls.has(id);
	if (opening && !effectiveFile && onLoadToolCalls) {
		loading = true;
		loadError = null;
		try {
			loadedFile = await onLoadToolCalls();
		} catch (error) {
			loadError =
				error instanceof Error ? error.message : "Failed to load tool details";
		} finally {
			loading = false;
		}
	}
	const next = new Set(expandedToolCalls);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expandedToolCalls = next;
}

const statusDotMap = {
	done: "bg-status-running",
	running: "bg-status-starting",
	failed: "bg-status-error",
} as const;
</script>

{#if toolUseBlocks.length > 0}
	<div class="mt-4">
		{#each toolUseBlocks as block (block.id)}
			{@const status = getToolStatus(block)}
			{@const fullTool = getFullTool(block.id)}
			{@const result = findToolResult(block.id)}
			{#if loadError}
				<button type="button" class="ml-[26px] rounded-md border border-status-error/30 bg-status-error/5 px-2 py-1 text-left text-[12px] text-status-error hover:bg-status-error/10" onclick={() => void toggleToolCall(block.id)}>
					{loadError} · Click to retry
				</button>
			{/if}
			<div class="group rounded-md overflow-hidden">
				<button
					type="button"
					class="w-full flex items-center gap-2 pl-0 pr-4 py-0.5 text-left transition-colors hover:bg-bg-hover/50 cursor-pointer"
					onclick={() => void toggleToolCall(block.id)}
				>
					<span class="inline-block w-1.5 h-1.5 rounded-full shrink-0 align-middle {statusDotMap[status]} {status === 'running' ? 'animate-pulse' : ''}"></span>
					<span class="text-[13px] font-mono text-text-tertiary shrink-0 w-[3em]">{block.name}</span>
					<span class="min-w-0 text-[13px] font-mono text-text-placeholder truncate">{summarizeToolInput(block.name, block.input)}</span>
					<span class="ml-auto text-text-tertiary shrink-0">
						{#if loading}
							<Loader2 class="w-3.5 h-3.5 animate-spin text-text-placeholder" />
						{:else if expandedToolCalls.has(block.id)}
							<ChevronDown class="w-3.5 h-3.5" />
						{:else}
							<ChevronRight class="w-3.5 h-3.5" />
						{/if}
					</span>
				</button>
				{#if expandedToolCalls.has(block.id)}
					<div class="pl-[26px] pr-4 py-1.5 space-y-2">
						{#if fullTool}
							<div>
								<div class="mb-1 flex items-center gap-1.5 text-[11px] text-text-placeholder"><Check class="h-3 w-3" />Input</div>
								<pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{JSON.stringify(fullTool.input, null, 2)}</pre>
							</div>
							{#if fullTool.result}
								<div>
									<div class="mb-1 text-[11px] text-text-placeholder">Result</div>
									{#if typeof fullTool.result.content === 'string'}
										<pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{fullTool.result.content}</pre>
									{:else if Array.isArray(fullTool.result.content)}
										<pre class="p-2 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-bg-code rounded-md">{JSON.stringify(fullTool.result.content, null, 2)}</pre>
									{/if}
								</div>
							{/if}
						{:else}
							<pre class="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-text-secondary">{JSON.stringify(block.input, null, 2)}</pre>
							{#if result?.type === 'tool_result' && result._meta?.resultDetail === 'omitted'}
								<div class="text-[12px] text-text-placeholder">Result omitted from summary. Expand again after details load.</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
