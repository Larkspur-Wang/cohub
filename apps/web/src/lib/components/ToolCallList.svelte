<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import { Loader2 } from "lucide-svelte";
import ToolCallItem from "$lib/components/ToolCallItem.svelte";
import { buildToolCallViewModels } from "$lib/components/tool-call-format";

type Props = {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
};

const { content, toolCallsFile = null, onLoadToolCalls }: Props = $props();
let loading = $state(false);
let loadError = $state<string | null>(null);
let loadedFile = $state<MessageToolCallsFile | null>(null);
let requestedLoad = $state(false);

const effectiveFile = $derived(toolCallsFile ?? loadedFile);
const tools = $derived(
	buildToolCallViewModels({ content, toolCallsFile: effectiveFile }),
);

$effect(() => {
	if (!onLoadToolCalls || effectiveFile || requestedLoad) return;
	if (!content.some((block) => block.type === "tool_use")) return;
	requestedLoad = true;
	loading = true;
	loadError = null;
	void onLoadToolCalls()
		.then((file) => {
			loadedFile = file;
		})
		.catch((error) => {
			loadError =
				error instanceof Error ? error.message : "Failed to load tool details";
		})
		.finally(() => {
			loading = false;
		});
});

function retryLoad() {
	requestedLoad = false;
}
</script>

{#if tools.length > 0}
	<div class="mt-3 space-y-0.5">
		{#if loadError}
			<button type="button" class="ml-[26px] mb-1 rounded-md border border-status-error/30 bg-status-error/5 px-2 py-1 text-left text-[12px] leading-snug text-status-error hover:bg-status-error/10" onclick={retryLoad}>
				{loadError} · Retry
			</button>
		{/if}
		{#each tools as tool (tool.id)}
			<ToolCallItem {tool} />
		{/each}
		{#if loading}
			<div class="ml-[26px] inline-flex items-center gap-1.5 py-0.5 text-[11px] text-text-placeholder">
				<Loader2 class="h-3 w-3 animate-spin" />
				Loading full tool details
			</div>
		{/if}
	</div>
{/if}
