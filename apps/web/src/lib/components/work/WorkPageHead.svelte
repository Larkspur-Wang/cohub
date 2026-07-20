<script lang="ts">
import type { WorkPageMeta } from "$lib/work-page-meta";

const {
	meta,
}: {
	meta: WorkPageMeta;
} = $props();
</script>

<svelte:head>
	<title>{meta.documentTitle}</title>
	<meta name="description" content={meta.description} />
	<meta name="robots" content={meta.robots} />
	<link rel="canonical" href={meta.canonical} />
	{#if meta.iconUrl}
		<link rel="icon" href={meta.iconUrl} />
		<link rel="apple-touch-icon" href={meta.iconUrl} />
	{/if}
	<meta name="application-name" content={meta.shortName} />
	<meta name="apple-mobile-web-app-title" content={meta.shortName} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={meta.name} />
	<meta property="og:title" content={meta.documentTitle} />
	<meta property="og:description" content={meta.description} />
	<meta property="og:url" content={meta.canonical} />
	{#if meta.imageUrl}
		<meta property="og:image" content={meta.imageUrl} />
	{/if}
	<meta name="twitter:card" content={meta.twitterCard} />
	<meta name="twitter:title" content={meta.documentTitle} />
	<meta name="twitter:description" content={meta.description} />
	{#if meta.imageUrl}
		<meta name="twitter:image" content={meta.imageUrl} />
	{/if}
	{@html `<script type="application/ld+json">${meta.jsonLd.replace(/</g, "\\u003c")}</script>`}
</svelte:head>
