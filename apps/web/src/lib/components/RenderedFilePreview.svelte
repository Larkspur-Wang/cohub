<script lang="ts">
import MarkdownView from "$lib/components/MarkdownView.svelte";

const {
	name,
	source,
	type,
	path = null,
	onOpenFile,
}: {
	name: string;
	source: string;
	type: "markdown" | "html";
	path?: string | null;
	onOpenFile?: (path: string) => void | Promise<void>;
} = $props();
</script>

{#if type === "markdown"}
	<MarkdownView {source} variant="document" baseFilePath={path} {onOpenFile} />
{:else}
	<iframe
		class="h-full w-full border-0 bg-white"
		title={`HTML preview: ${name}`}
		sandbox="allow-scripts"
		srcdoc={source}
	></iframe>
{/if}
