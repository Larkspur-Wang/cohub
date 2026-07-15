<script lang="ts">
import { entries } from "$lib/changelog";

/** Render trusted inline markdown (bold + code) from our own changelog data. */
function renderInline(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function formatDate(iso: string): string {
	return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}
</script>

<svelte:head>
	<title>Changelog · Cohub</title>
	<meta name="description" content="What's new in Cohub" />
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
	<header class="mb-12">
		<a href="/" class="text-[13px] text-text-tertiary transition-colors hover:text-text-primary">← Cohub</a>
		<h1 class="mt-4 text-3xl font-semibold tracking-tight text-text-primary">Changelog</h1>
		<p class="mt-2 text-[15px] text-text-secondary">What's new in Cohub</p>
	</header>

	{#if entries.length === 0}
		<p class="text-text-tertiary">No entries yet.</p>
	{:else}
		<div class="space-y-12">
			{#each entries as entry (entry.version)}
				<article id="v{entry.version}" class="scroll-mt-20">
					<div class="mb-4 flex items-baseline gap-3">
						<h2 class="text-xl font-semibold text-text-primary">
							<a href="#v{entry.version}" class="transition-colors hover:text-brand">v{entry.version}</a>
						</h2>
						<time class="text-[13px] text-text-tertiary">{formatDate(entry.date)}</time>
					</div>

					<ul class="space-y-2.5 text-[14px] leading-relaxed">
						{#each entry.highlights as highlight}
							<li class="changelog-item flex gap-2.5">
								<span class="mt-px select-none text-brand">•</span>
								<span class="min-w-0 text-text-primary">{@html renderInline(highlight)}</span>
							</li>
						{/each}
					</ul>

					{#if entry.fixes?.length}
						<details class="mt-4">
							<summary class="cursor-pointer text-[13px] text-text-tertiary transition-colors hover:text-text-secondary">
								Fixes ({entry.fixes.length})
							</summary>
							<ul class="mt-2.5 space-y-1.5 text-[13px]">
								{#each entry.fixes as fix}
									<li class="changelog-item flex gap-2.5">
										<span class="mt-px select-none text-text-placeholder">•</span>
										<span class="min-w-0 text-text-secondary">{@html renderInline(fix)}</span>
									</li>
								{/each}
							</ul>
						</details>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.changelog-item :global(strong) {
		font-weight: 600;
	}
	.changelog-item :global(code) {
		border-radius: 4px;
		background: var(--bg-input, rgba(128, 128, 128, 0.12));
		padding: 0.1em 0.35em;
		font-family: ui-monospace, monospace;
		font-size: 0.9em;
	}
</style>
