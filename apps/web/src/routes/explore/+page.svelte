<script lang="ts">
import type { ExploreSpaceItem } from "@neta-art/cohub";
import { FolderKanban, GitFork, Loader2, Lock, Pin, Save } from "lucide-svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import { sdk } from "$lib/sdk";

let items = $state<ExploreSpaceItem[]>([]);
let loading = $state(true);
let error = $state("");

function formatCount(n: number): string {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

$effect(() => {
	loading = true;
	error = "";
	sdk.explore
		.spaces()
		.then((result) => {
			items = result.spaces ?? [];
		})
		.catch((err) => {
			error = err instanceof Error ? err.message : "Failed to load Explore";
		})
		.finally(() => {
			loading = false;
		});
});
</script>

<svelte:head>
	<title>Explore — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<PageHeader>
		{#snippet left()}
			<span class="text-[13px] lg:text-[11px] font-medium text-text-primary lg:text-text-secondary">Explore</span>
		{/snippet}
	</PageHeader>

	<div class="flex-1 overflow-y-auto px-6 py-8">
		<div class="mx-auto max-w-5xl">
			<div class="mb-8">
				<div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-placeholder">Public spaces</div>
				<h1 class="mt-2 text-[28px] font-semibold tracking-tight text-text-primary">Explore Spaces</h1>
				<p class="mt-2 max-w-2xl text-[13px] leading-6 text-text-tertiary">Watch live agent workspaces, inspect saves, and fork a useful starting point into your own Space.</p>
			</div>

			{#if loading}
				<div class="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface p-4 text-[13px] text-text-tertiary">
					<Loader2 class="h-4 w-4 animate-spin" />
					Loading spaces…
				</div>
			{:else if error}
				<div class="rounded-md border border-error-soft/30 bg-error-bg p-4 text-[13px] text-error-soft">{error}</div>
			{:else if items.length === 0}
				<div class="rounded-md border border-border-subtle bg-bg-surface p-6">
					<div class="text-[15px] font-medium text-text-primary">No spaces listed yet</div>
					<p class="mt-1 text-[13px] text-text-tertiary">Explore is ready. Add public spaces to <code class="font-mono text-text-secondary">platform/.cohub/explore.json</code> to feature them here.</p>
				</div>
			{:else}
				<div class="space-y-3">
					{#each items as item (item.space.id)}
						<a
							href="/spaces/{item.space.id}"
							class="group block rounded-[10px] border border-border-subtle bg-bg-surface p-4 transition-colors hover:border-border-strong hover:bg-bg-hover/40"
						>
							<div class="flex items-start gap-4">
								<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] border border-border-subtle bg-bg-elevated text-[15px] font-semibold text-text-secondary">
									{item.space.name?.slice(0, 1).toUpperCase() ?? "S"}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<h2 class="truncate text-[15px] font-semibold text-text-primary">{item.space.name ?? item.space.id}</h2>
										{#if item.explore.label}
											<span class="rounded-[4px] border border-brand/20 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-brand">{item.explore.label}</span>
										{/if}
										<span class="inline-flex items-center gap-1 text-[11px] text-text-placeholder">
											{#if item.accessAudience === "anonymous"}
												<FolderKanban class="h-3 w-3" /> Public
											{:else}
												<Lock class="h-3 w-3" /> Sign-in required
											{/if}
										</span>
									</div>
									{#if item.space.description}
										<p class="mt-1 line-clamp-2 text-[13px] leading-6 text-text-tertiary">{item.space.description}</p>
									{/if}
									<div class="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-text-tertiary">
										<span class="inline-flex items-center gap-1"><Pin class="h-3.5 w-3.5" /> {item.stats.pinnedCount} pinned</span>
										<span class="inline-flex items-center gap-1"><Save class="h-3.5 w-3.5" /> {item.stats.checkpointCount} saves</span>
										<span class="inline-flex items-center gap-1"><GitFork class="h-3.5 w-3.5" /> {formatCount(item.stats.forkCount)} forks</span>
										{#if item.sandboxStatus}<span>{item.sandboxStatus}</span>{/if}
									</div>
									{#if item.latestCheckpoints[0]}
										<div class="mt-3 rounded-[6px] border border-border-subtle bg-bg-primary/60 px-3 py-2 text-[12px] text-text-secondary">
											<span class="text-text-placeholder">Latest save:</span> {item.latestCheckpoints[0].description || item.latestCheckpoints[0].commitHash.slice(0, 12)}
										</div>
									{/if}
								</div>
								<div class="shrink-0 text-[12px] font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">Open</div>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
