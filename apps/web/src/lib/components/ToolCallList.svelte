<script lang="ts">
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { MessageToolCallsFile } from "@neta-art/cohub-protocol/model";
import ToolCallItem from "$lib/components/ToolCallItem.svelte";
import { buildToolCallViewModels } from "$lib/components/tool-call-format";

type Props = {
	content: ContentBlock[];
	toolCallsFile?: MessageToolCallsFile | null;
	onLoadToolCalls?: () => Promise<MessageToolCallsFile | null>;
	flush?: boolean;
};

const {
	content,
	toolCallsFile = null,
	onLoadToolCalls,
	flush = false,
}: Props = $props();
let loading = $state(false);
let loadError = $state<string | null>(null);
let loadedFile = $state<MessageToolCallsFile | null>(null);
let requestedLoad = $state(false);

const effectiveFile = $derived(toolCallsFile ?? loadedFile);
const tools = $derived(
	buildToolCallViewModels({ content, toolCallsFile: effectiveFile }),
);

async function ensureLoaded() {
	if (!onLoadToolCalls || effectiveFile || loading) return;
	requestedLoad = true;
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

function retryLoad() {
	requestedLoad = false;
	void ensureLoaded();
}
</script>

{#if tools.length > 0}
	<div class={flush ? "space-y-0.5" : "mt-2 space-y-0.5"}>
		{#if loadError}
			<button
				type="button"
				class="timeline-row-nested mb-1 rounded-md border border-status-error/30 bg-status-error/5 px-2 py-1 text-left text-[12px] leading-snug text-status-error hover:bg-status-error/10"
				onclick={retryLoad}
			>
				{loadError} · Retry
			</button>
		{/if}
		{#each tools as tool (tool.id)}
			<ToolCallItem {tool} loading={loading && requestedLoad && !effectiveFile} needsDetails={Boolean(onLoadToolCalls) && !effectiveFile} onExpand={ensureLoaded} />
		{/each}
	</div>
{/if}
