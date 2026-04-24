<script lang="ts">
import type { ModelRow, SpaceRow, UserRow } from "$lib/trending";
import { fetchModels, fetchSpaces, fetchUsers } from "$lib/trending";

type Tab = "spaces" | "users" | "models";

const tabs: { id: Tab; label: string }[] = [
	{ id: "spaces", label: "Spaces" },
	{ id: "users", label: "Users" },
	{ id: "models", label: "Models" },
];

let activeTab = $state<Tab>("spaces");
let spaces = $state<SpaceRow[]>([]);
let users = $state<UserRow[]>([]);
let models = $state<ModelRow[]>([]);
let loading = $state(true);
let loaded = $state(false);
let prevTab = $state<Tab>("spaces");

function formatNumber(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

function getDisplayName(tab: Tab, row: SpaceRow | UserRow | ModelRow): string {
	switch (tab) {
		case "spaces":
			return (row as SpaceRow).spaceName;
		case "users":
			return (row as UserRow).userDisplay;
		case "models":
			return (row as ModelRow).modelDisplay;
	}
}

function getSubline(tab: Tab, row: SpaceRow | UserRow | ModelRow): string {
	if (tab === "spaces") {
		return `by ${(row as SpaceRow).userDisplay}`;
	}
	return "";
}

async function loadData() {
	loading = true;
	const [s, u, m] = await Promise.all([
		fetchSpaces(),
		fetchUsers(),
		fetchModels(),
	]);
	spaces = s;
	users = u;
	models = m;
	loading = false;
	loaded = true;
}

$effect(() => {
	loadData();
});

function switchTab(tab: Tab) {
	prevTab = activeTab;
	activeTab = tab;
}

const currentRows = $derived.by(() => {
	switch (activeTab) {
		case "spaces":
			return spaces;
		case "users":
			return users;
		case "models":
			return models;
	}
});

const hasData = $derived(
	activeTab === "spaces"
		? spaces.length > 0
		: activeTab === "users"
			? users.length > 0
			: models.length > 0,
);
</script>

<svelte:head>
	<title>Trending — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<!-- Header — generous top spacing, tight title+subtitle grouping -->
	<div class="px-6 pt-10 pb-0 shrink-0">
		<h1 class="text-[28px] font-semibold tracking-tight text-text-primary">Trending</h1>
		<p class="mt-1 text-[13px] leading-snug text-text-tertiary">Yesterday's platform leaderboard</p>
	</div>

	<!-- Tabs — generous gap from header -->
	<div class="flex gap-0 px-6 mt-6 mb-6 border-b border-border-subtle shrink-0">
		{#each tabs as tab}
			<button
				type="button"
				class="px-3 py-2.5 text-[13px] font-medium transition-colors duration-150 relative {activeTab === tab.id ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => switchTab(tab.id)}
			>
				{tab.label}
				{#if activeTab === tab.id}
					<span class="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full"></span>
				{/if}
			</button>
		{/each}
	</div>

	<!-- Content -->
	<div class="flex-1 px-6 pb-6 overflow-y-auto">
		{#if loading}
			<div class="flex items-center justify-center py-24">
				<div class="flex items-center gap-2 text-text-tertiary">
					<svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
					</svg>
					<span class="text-[13px]">Loading...</span>
				</div>
			</div>
		{:else if !hasData}
			<div class="py-20">
				<div class="text-[13px] text-text-tertiary">
					{#if loaded}Yesterday's data is being collected{:else}No data available{/if}
				</div>
			</div>
		{:else}
			<!-- Table header — subdued, uppercase, tracking -->
			<div class="grid grid-cols-[32px_1fr_96px_80px_88px] gap-x-4 gap-y-0 px-0 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-placeholder border-b border-border-subtle">
				<span></span>
				<span></span>
				<span class="text-right">Tokens</span>
				<span class="text-right">Sessions</span>
				<span class="text-right">Reqs</span>
			</div>

			<!-- Rows — staggered fade-in, varied visual treatment by rank -->
			<div class="mt-0">
				{#each currentRows as row, i (row.rank)}
					<div
						class="grid grid-cols-[32px_1fr_96px_80px_88px] gap-x-4 gap-y-0 px-0 transition-all duration-300 ease-out"
						class:row-top={row.rank <= 3}
						class:row-data={row.rank > 3}
						style="--row-index: {i}; animation: rowFadeIn 0.35s ease-out both; animation-delay: {i * 35}ms;"
					>
						<!-- Rank — #1 gets brand badge, #2-3 get brand number, rest muted -->
						<div class="flex items-center justify-center py-3">
							{#if row.rank === 1}
								<span class="flex items-center justify-center w-6 h-6 rounded-[4px] bg-brand text-[11px] font-bold text-white">1</span>
							{:else if row.rank === 2}
								<span class="text-[13px] font-semibold text-brand">2</span>
							{:else if row.rank === 3}
								<span class="text-[13px] font-semibold text-brand">3</span>
							{:else}
								<span class="text-[12px] text-text-disabled tabular-nums">{row.rank}</span>
							{/if}
						</div>

						<!-- Name + subline -->
						<div class="min-w-0 py-3">
							<div class="text-[13px] font-medium text-text-primary truncate">
								{getDisplayName(activeTab, row)}
							</div>
							{#if getSubline(activeTab, row)}
								<div class="text-[11px] text-text-tertiary mt-0.5 truncate">
									{getSubline(activeTab, row)}
								</div>
							{/if}
						</div>

						<!-- Tokens — primary metric, monospace -->
						<div class="flex items-center justify-end py-3">
							<span class="text-[13px] text-text-primary font-mono tabular-nums">
								{formatNumber(row.totalTokens)}
							</span>
						</div>

						<!-- Sessions -->
						<div class="flex items-center justify-end py-3">
							<span class="text-[13px] text-text-secondary tabular-nums">
								{row.sessionCount}
							</span>
						</div>

						<!-- Requests -->
						<div class="flex items-center justify-end py-3">
							<span class="text-[13px] text-text-secondary tabular-nums">
								{formatNumber(row.requestCount)}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes rowFadeIn {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.row-top {
		border-bottom: 1px solid var(--border-subtle);
	}

	.row-data {
		border-bottom: 1px solid oklch(32% 0.007 250 / 0.4);
	}

	/* light theme row divider */
	:global([data-theme="light"]) .row-data {
		border-bottom: 1px solid oklch(93% 0.004 250 / 0.6);
	}
</style>
