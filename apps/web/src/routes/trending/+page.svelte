<script lang="ts">
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import type { ModelRow, SpaceRow, UserProfile, UserRow } from "$lib/trending";
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

function toFiniteNumber(value: unknown, fallback = 0): number {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatNumber(n: number): string {
	const value = toFiniteNumber(n);
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

function formatCost(n: number): string {
	const value = toFiniteNumber(n);
	const formatted =
		value >= 1
			? value.toFixed(2)
			: value >= 0.01
				? value.toFixed(3)
				: value.toFixed(4);
	return `${formatted}`;
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

function getSpaceHref(
	tab: Tab,
	row: SpaceRow | UserRow | ModelRow,
): string | null {
	if (tab !== "spaces") return null;
	return buildSpaceLandingRoute((row as SpaceRow).spaceId);
}

function getUserProfile(
	tab: Tab,
	row: SpaceRow | UserRow | ModelRow,
): UserProfile | null {
	if (tab === "spaces") return (row as SpaceRow).userProfile;
	if (tab === "users") return (row as UserRow).userProfile;
	return null;
}

function getInitials(name: string): string {
	const initials = name
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? "")
		.join("");
	return initials || "U";
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
	<div class="px-4 pt-8 pb-0 shrink-0 sm:px-6 sm:pt-10">
		<h1 class="text-[28px] font-semibold tracking-tight text-text-primary">Trending</h1>
		<p class="mt-1 text-[13px] leading-snug text-text-tertiary">Yesterday's platform leaderboard</p>
	</div>

	<!-- Tabs — generous gap from header -->
	<div class="flex gap-0 px-4 mt-5 mb-4 border-b border-border-subtle shrink-0 sm:px-6 sm:mt-6 sm:mb-6">
		{#each tabs as tab}
			<button
				type="button"
				aria-pressed={activeTab === tab.id}
				class="relative min-h-11 px-3 py-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary {activeTab === tab.id ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}"
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
	<div class="flex-1 px-4 pb-6 overflow-y-auto sm:px-6">
		{#if loading}
			<CenteredLoading label="Loading…" />
		{:else if !hasData}
			<div class="py-20">
				<div class="text-[13px] text-text-tertiary">
					{#if loaded}Yesterday's data is being collected{:else}No data available{/if}
				</div>
			</div>
		{:else}
			<!-- Table — header and rows share one adaptive grid -->
			<div class="trending-table">
				<div class="trending-table-row px-0 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-placeholder border-b border-border-subtle sm:pb-3">
					<span></span>
					<span class="truncate">Name</span>
					<span class="text-right">Tokens</span>
					<span class="hidden text-right sm:block">Cost</span>
					<span class="hidden text-right sm:block">Sessions</span>
					<span class="hidden text-right sm:block">Reqs</span>
				</div>

				<!-- Rows — staggered fade-in, varied visual treatment by rank -->
				{#each currentRows as row, i (row.rank)}
					{@const userProfile = getUserProfile(activeTab, row)}
					{@const spaceHref = getSpaceHref(activeTab, row)}
					<div
						class="trending-table-row px-0 transition-all duration-300 ease-out"
						class:row-top={row.rank <= 3}
						class:row-data={row.rank > 3}
						style="--row-index: {i}; animation: rowFadeIn 0.35s ease-out both; animation-delay: {i * 35}ms;"
					>
						<!-- Rank — #1 gets brand badge, #2-3 get brand number, rest muted -->
						<div class="row-span-2 flex min-h-12 items-start justify-center py-2.5 sm:row-span-1 sm:min-h-0 sm:items-center sm:py-3">
							{#if row.rank === 1}
								<span class="flex items-center justify-center w-6 h-6 rounded-[4px] bg-brand text-[11px] font-bold text-brand-contrast-fg">1</span>
							{:else if row.rank === 2}
								<span class="text-[13px] font-semibold text-brand">2</span>
							{:else if row.rank === 3}
								<span class="text-[13px] font-semibold text-brand">3</span>
							{:else}
								<span class="text-[12px] text-text-disabled tabular-nums">{row.rank}</span>
							{/if}
						</div>

						<!-- Name + subline -->
						<div class="min-w-0 py-2.5 sm:py-3">
							<div class="flex min-w-0 items-center gap-2">
								{#if activeTab === 'spaces'}
									<SpaceAvatar name={(row as SpaceRow).spaceName} profile={(row as SpaceRow).spaceProfile} size="sm" />
								{:else if activeTab === 'users' && userProfile}
									<div class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-bg-hover-strong text-[10px] font-semibold text-text-tertiary">
										{#if userProfile.avatarUrl}
											<img src={userProfile.avatarUrl} alt="" class="h-full w-full object-cover" />
										{:else}
											{getInitials(userProfile.displayName)}
										{/if}
									</div>
								{/if}
								{#if spaceHref}
									<a
										href={spaceHref}
										class="trending-name min-w-0 text-[14px] font-medium leading-snug text-text-primary transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary sm:truncate sm:text-[13px] sm:leading-normal"
										data-sveltekit-preload-data="hover"
									>
										{getDisplayName(activeTab, row)}
									</a>
								{:else}
									<div class="trending-name min-w-0 text-[14px] font-medium leading-snug text-text-primary sm:truncate sm:text-[13px] sm:leading-normal">
										{getDisplayName(activeTab, row)}
									</div>
								{/if}
							</div>
							{#if activeTab === 'spaces' && userProfile}
								<div class="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-text-tertiary sm:mt-0.5 sm:text-[11px]">
									<span>by</span>
									<div class="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-hover-strong text-[7px] font-semibold text-text-tertiary">
										{#if userProfile.avatarUrl}
											<img src={userProfile.avatarUrl} alt="" class="h-full w-full object-cover" />
										{:else}
											{getInitials(userProfile.displayName)}
										{/if}
									</div>
									<span class="min-w-0 truncate">{userProfile.displayName}</span>
								</div>
							{:else if getSubline(activeTab, row)}
								<div class="mt-1 truncate text-[12px] text-text-tertiary sm:mt-0.5 sm:text-[11px]">
									{getSubline(activeTab, row)}
								</div>
							{/if}
						</div>

						<!-- Tokens — primary metric, monospace -->
						<div class="flex items-start justify-end py-2.5 sm:items-center sm:py-3">
							<span class="font-mono text-[13px] tabular-nums text-text-primary sm:text-[13px]">
								{formatNumber(row.totalTokens)}
							</span>
						</div>

						<!-- Secondary metrics — inline on mobile, table columns from sm upward -->
						<div class="col-start-2 col-span-2 -mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 pb-2.5 text-[12px] leading-none text-text-tertiary sm:hidden">
							<span><span class="text-text-placeholder">Cost</span> <span class="font-mono tabular-nums text-text-secondary">{formatCost(row.costTotal)}</span></span>
							<span><span class="text-text-placeholder">Sessions</span> <span class="tabular-nums text-text-secondary">{row.sessionCount}</span></span>
							<span><span class="text-text-placeholder">Reqs</span> <span class="tabular-nums text-text-secondary">{formatNumber(row.requestCount)}</span></span>
						</div>

						<!-- Cost -->
						<div class="hidden items-center justify-end py-2 sm:flex sm:py-3">
							<span class="text-[13px] text-text-secondary font-mono tabular-nums">
								{formatCost(row.costTotal)}
							</span>
						</div>

						<!-- Sessions -->
						<div class="hidden items-center justify-end py-2 sm:flex sm:py-3">
							<span class="text-[13px] text-text-secondary tabular-nums">
								{row.sessionCount}
							</span>
						</div>

						<!-- Requests -->
						<div class="hidden items-center justify-end py-2 sm:flex sm:py-3">
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

	.trending-table {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr) auto;
		column-gap: 0.5rem;
	}

	.trending-table-row {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
		column-gap: inherit;
	}

	.trending-name {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.row-top {
		border-bottom: 1px solid var(--border-subtle);
	}

	.row-data {
		border-bottom: 1px solid var(--divider-muted);
	}

	@media (min-width: 640px) {
		.trending-table {
			grid-template-columns: 28px minmax(0, 1fr) minmax(64px, auto) minmax(64px, auto) minmax(48px, auto) minmax(48px, auto);
			column-gap: 1rem;
		}

		.trending-name {
			display: block;
			-webkit-line-clamp: unset;
			line-clamp: unset;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.row-top,
		.row-data {
			animation-duration: 1ms !important;
			animation-delay: 0ms !important;
		}
	}
</style>
