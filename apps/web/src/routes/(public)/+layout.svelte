<script lang="ts">
import "../../app.css";
import { page } from "$app/state";

const { children } = $props();

/** Public Work routes set their own icons via WorkPageHead. */
const isPublicWorkPath = $derived.by(() => {
	const segments = page.url.pathname.split("/").filter(Boolean);
	return segments.length === 4 && segments[2] === "w";
});
</script>

{#if !isPublicWorkPath}
	<svelte:head>
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="apple-touch-icon" href="/pwa/icon-192x192.png" />
	</svelte:head>
{/if}

<div class="min-h-screen overflow-x-hidden bg-bg-primary text-text-primary">
	{@render children?.()}
</div>
