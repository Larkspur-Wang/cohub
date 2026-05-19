<script lang="ts">
import type { ExploreSection, ExploreSpaceItem } from "@neta-art/cohub";
import {
	FolderKanban,
	GitFork,
	Loader2,
	Lock,
	Pin,
	Save,
	Sparkles,
} from "lucide-svelte";
import PageHeader from "$lib/components/PageHeader.svelte";
import { sdk } from "$lib/sdk";

let sections = $state<ExploreSection[]>([]);
let spaces = $state<ExploreSpaceItem[]>([]);
let loading = $state(true);
let error = $state("");

function formatCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function getInitials(name: string): string {
	const initials = name
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");
	return initials || "S";
}

function getPrimaryMeta(item: ExploreSpaceItem): string | null {
	return item.explore.label ?? item.explore.category ?? null;
}

function getLatestSignal(item: ExploreSpaceItem): string | null {
	const latest = item.latestCheckpoints[0];
	return latest ? latest.description || latest.commitHash.slice(0, 12) : null;
}

$effect(() => {
	loading = true;
	error = "";
	sdk.explore
		.spaces()
		.then((result) => {
			sections = result.sections ?? [];
			spaces = result.spaces ?? [];
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

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<PageHeader>
		{#snippet left()}
			<div class="flex min-w-0 items-center gap-2">
				<Sparkles class="h-4 w-4 text-brand" />
				<div class="min-w-0">
					<div class="text-[13px] font-medium text-text-primary lg:text-text-secondary">Explore</div>
					<div class="hidden text-[11px] text-text-tertiary lg:block">Curated spaces, tuned by configuration</div>
				</div>
			</div>
		{/snippet}
	</PageHeader>

	<div class="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
		<div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
			<section class="max-w-3xl">
				<div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-placeholder">Public spaces</div>
				<h1 class="mt-2 text-[clamp(2rem,3vw,3.25rem)] font-semibold tracking-tight text-text-primary">Explore spaces with intent</h1>
				<p class="mt-3 max-w-2xl text-[13px] leading-6 text-text-tertiary sm:text-[14px] sm:leading-7">Discover carefully surfaced spaces, scan the owner profile first, then jump into the workspace when it feels worth opening.</p>
			</section>

			{#if loading}
				<div class="flex items-center gap-2 rounded-[14px] border border-border-subtle bg-bg-surface px-4 py-4 text-[13px] text-text-tertiary">
					<Loader2 class="h-4 w-4 animate-spin" />
					Loading spaces…
				</div>
			{:else if error}
				<div class="rounded-[14px] border border-error-soft/30 bg-error-bg px-4 py-4 text-[13px] text-error-soft">{error}</div>
			{:else if spaces.length === 0}
				<div class="rounded-[14px] border border-border-subtle bg-bg-surface p-6">
					<div class="text-[15px] font-medium text-text-primary">No spaces listed yet</div>
					<p class="mt-1 text-[13px] text-text-tertiary">Explore is ready. Add public spaces to <code class="font-mono text-text-secondary">platform/.cohub/explore.json</code> to feature them here.</p>
				</div>
			{:else}
				<div class="space-y-8">
					{#each sections.length > 0 ? sections : [{ key: "all", title: null, subtitle: null, description: null, spaces }] as section (section.key)}
						{#if section.spaces.length > 0}
							<section class="space-y-4">
								{#if section.title || section.subtitle || section.description}
									<div class="max-w-3xl">
										{#if section.subtitle}
											<div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-placeholder">{section.subtitle}</div>
										{/if}
										{#if section.title}
											<h2 class="mt-1 text-[18px] font-semibold tracking-tight text-text-primary sm:text-[20px]">{section.title}</h2>
										{/if}
										{#if section.description}
											<p class="mt-1 max-w-2xl text-[13px] leading-6 text-text-tertiary">{section.description}</p>
										{/if}
									</div>
								{/if}

								<div class="grid gap-3 sm:gap-4">
									{#each section.spaces as item (item.space.id)}
										{@const owner = item.ownerProfile ?? item.space.ownerProfile ?? null}
										{@const latestSignal = getLatestSignal(item)}
										{@const primaryMeta = getPrimaryMeta(item)}
										<a
											href={`/spaces/${item.space.id}`}
											class="group block rounded-[18px] border border-border-subtle bg-bg-surface px-4 py-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-hover/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary sm:px-5 sm:py-5"
											data-sveltekit-preload-data="hover"
										>
											<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
												<div class="flex min-w-0 flex-1 items-start gap-3">
													<div class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-border-subtle bg-bg-elevated text-[13px] font-semibold text-text-secondary">
														{#if owner?.avatarUrl}
															<img src={owner.avatarUrl} alt="" class="h-full w-full object-cover" />
														{:else}
															{getInitials(owner?.displayName ?? item.space.name ?? item.space.id)}
														{/if}
													</div>
													<div class="min-w-0 flex-1">
														<div class="flex flex-wrap items-center gap-2">
															<h3 class="truncate text-[16px] font-semibold tracking-tight text-text-primary sm:text-[17px]">{item.space.name ?? item.space.id}</h3>
															{#if primaryMeta}
																<span class="rounded-full border border-border-subtle bg-bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-text-tertiary">{primaryMeta}</span>
															{/if}
														</div>
														<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-tertiary">
															{#if owner}
																<span class="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-primary/70 px-2 py-1 text-[11px] text-text-secondary">
																	<span class="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-bg-hover-strong text-[8px] font-semibold text-text-tertiary">
																		{#if owner.avatarUrl}
																			<img src={owner.avatarUrl} alt="" class="h-full w-full object-cover" />
																		{:else}
																			{getInitials(owner.displayName)}
																		{/if}
																	</span>
																	<span class="truncate">{owner.displayName}</span>
																</span>
															{/if}
															<span class="inline-flex items-center gap-1">
																{#if item.accessAudience === "anonymous"}
																	<FolderKanban class="h-3.5 w-3.5" /> Public
																{:else}
																	<Lock class="h-3.5 w-3.5" /> Sign-in required
																{/if}
															</span>
														</div>
														{#if item.space.description}
															<p class="mt-3 max-w-3xl text-[13px] leading-6 text-text-tertiary sm:text-[14px]">{item.space.description}</p>
														{/if}
														<div class="mt-4 flex flex-wrap items-center gap-2">
															<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[11px] text-text-secondary"><Pin class="h-3.5 w-3.5 text-text-tertiary" /> {item.stats.pinnedCount}</span>
															<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[11px] text-text-secondary"><Save class="h-3.5 w-3.5 text-text-tertiary" /> {item.stats.checkpointCount}</span>
															<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-primary px-2.5 py-1 text-[11px] text-text-secondary"><GitFork class="h-3.5 w-3.5 text-text-tertiary" /> {formatCount(item.stats.forkCount)}</span>
														</div>
													</div>
												</div>

												<div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4 text-[11px] text-text-tertiary">
													<div class="flex flex-wrap items-center gap-2">
														{#if latestSignal}
															<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-primary/70 px-2 py-1"><Sparkles class="h-3.5 w-3.5" /> Latest save: {latestSignal}</span>
														{/if}
														{#if item.sandboxStatus}
															<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-primary/70 px-2 py-1">Sandbox {item.sandboxStatus}</span>
														{/if}
													</div>
													<span class="inline-flex items-center gap-1 font-medium text-text-secondary transition-colors group-hover:text-brand">Open <span aria-hidden="true">→</span></span>
												</div>
											</div>
										</a>
									{/each}
								</div>
							</section>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
