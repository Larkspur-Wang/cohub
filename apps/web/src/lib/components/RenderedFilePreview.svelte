<script lang="ts">
import MarkdownView from "$lib/components/MarkdownView.svelte";

const {
	name,
	source,
	type,
}: {
	name: string;
	source: string;
	type: "markdown" | "html";
} = $props();
</script>

{#if type === "markdown"}
	<MarkdownView {source} variant="document" />
{:else}
	<iframe
		class="h-full w-full border-0 bg-white"
		title={`HTML preview: ${name}`}
		sandbox="allow-scripts"
		srcdoc={source}
	></iframe>
{/if}
