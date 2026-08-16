<script lang="ts">
import { Loader2, RefreshCw } from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";
import {
	type ActivityDay,
	buildActivityDays,
	formatCompact,
	formatCost,
	formatDay,
	getActivityStats,
	isActivityCacheFresh,
	readActivityCache,
	writeActivityCache,
} from "$lib/user-activity";

const ranges = [
	{ days: 30, label: "30D" },
	{ days: 90, label: "90D" },
	{ days: 365, label: "1Y" },
] as const;

let selectedDays = $state(90);
let activityDays = $state<ActivityDay[] | null>(null);
let loading = $state(true);
let refreshing = $state(false);
let loadError = $state("");
let requestId = 0;

const displayedDays = $derived(activityDays ?? []);
const stats = $derived(getActivityStats(displayedDays));
const tokenTotal = $derived(
	stats.inputTokens +
		stats.outputTokens +
		stats.cacheReadTokens +
		stats.cacheWriteTokens,
);
const maxTokens = $derived(
	Math.max(0, ...displayedDays.map((day) => day.tokens)),
);
const heatmapDays = $derived.by((): Array<ActivityDay | null> => {
	if (!displayedDays.length) return [];
	const leading = new Date(`${displayedDays[0].date}T12:00:00`).getDay();
	const values: Array<ActivityDay | null> = [
		...Array.from({ length: leading }, () => null),
		...displayedDays,
	];
	while (values.length % 7) values.push(null);
	return values;
});

function heatLevel(day: ActivityDay) {
	if (!day.requests) return 0;
	if (!day.tokens || !maxTokens) return 1;
	const ratio = day.tokens / maxTokens;
	if (ratio < 0.08) return 1;
	if (ratio < 0.25) return 2;
	if (ratio < 0.55) return 3;
	return 4;
}

function dayTitle(day: ActivityDay) {
	const generation = day.generationRequests
		? ` · ${formatCompact(day.generationRequests)} generation`
		: "";
	return `${formatDay(day.date)} · ${formatCompact(day.tokens)} tokens · ${formatCompact(day.requests)} requests${generation}`;
}

async function loadActivity({ force = false } = {}) {
	const id = ++requestId;
	loadError = "";
	await authStore.ensureLoaded();
	const userUuid = authStore.userUuid;
	if (!userUuid) {
		loading = false;
		return;
	}

	const cached = readActivityCache(userUuid, selectedDays);
	if (cached && !force) activityDays = cached.activityDays;
	loading = !activityDays;
	refreshing = Boolean(activityDays);
	try {
		if (!force && cached && isActivityCacheFresh(cached)) {
			refreshing = false;
			return;
		}
		// One extra rolling day guarantees complete local calendar days across time zones and DST.
		const data = await sdk.user.getUsage(selectedDays + 1);
		if (id !== requestId) return;
		const nextActivityDays = buildActivityDays(data, selectedDays);
		activityDays = nextActivityDays;
		writeActivityCache(userUuid, selectedDays, nextActivityDays);
	} catch (error) {
		if (id !== requestId) return;
		if (await handleUnauthorizedError(error, page.url.pathname)) return;
		loadError =
			error instanceof Error ? error.message : "Failed to load activity";
	} finally {
		if (id === requestId) {
			loading = false;
			refreshing = false;
		}
	}
}

function selectRange(days: number) {
	if (selectedDays === days) return;
	selectedDays = days;
	activityDays = null;
	void loadActivity();
}

onMount(async () => {
	if (!(await ensureAuth({ redirectPath: page.url.pathname }))) return;
	void loadActivity();
});
</script>

<svelte:head>
	<title>Activity — Cohub</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="w-full max-w-5xl px-4 py-7 sm:px-6 lg:px-8">
		<header class="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle pb-5">
			<div>
				<h1 class="text-[18px] font-semibold text-text-primary">Activity</h1>
				<p class="mt-1 text-[13px] leading-5 text-text-tertiary">Your Cohub usage across spaces.</p>
			</div>
			<div class="flex items-center gap-2">
				<div class="flex rounded-md bg-bg-surface p-0.5" aria-label="Activity range">
					{#each ranges as range (range.days)}
						<button type="button" class="min-w-11 rounded-[4px] px-2.5 py-1.5 text-[11px] font-medium transition-colors {selectedDays === range.days ? 'bg-bg-active text-text-primary' : 'text-text-placeholder hover:text-text-secondary'}" aria-pressed={selectedDays === range.days} onclick={() => selectRange(range.days)}>{range.label}</button>
					{/each}
				</div>
				<button type="button" class="flex h-8 w-8 items-center justify-center rounded-md text-text-placeholder transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" title="Refresh activity" aria-label="Refresh activity" disabled={loading || refreshing} onclick={() => void loadActivity({ force: true })}>
					<RefreshCw class={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
				</button>
			</div>
		</header>

		{#if loading}
			<div class="flex min-h-72 items-center justify-center"><Loader2 class="h-5 w-5 animate-spin text-text-placeholder" /></div>
		{:else if !activityDays}
			<div class="py-16 text-center">
				<p class="text-[13px] text-text-secondary">Activity is unavailable.</p>
				{#if loadError}<p class="mt-2 text-[12px] text-error-soft">{loadError}</p>{/if}
				<button type="button" class="mt-4 text-[12px] font-medium text-brand hover:underline" onclick={() => void loadActivity({ force: true })}>Try again</button>
			</div>
		{:else}
			<section class="grid grid-cols-2 border-b border-border-subtle py-6 sm:grid-cols-4" aria-label="Activity summary">
				<div class="border-r border-border-subtle px-3 first:pl-0 sm:px-5"><div class="font-mono text-[20px] text-text-primary sm:text-[22px]">{formatCompact(stats.totalTokens)}</div><div class="mt-1 text-[11px] text-text-placeholder">Tokens</div></div>
				<div class="px-3 sm:border-r sm:border-border-subtle sm:px-5"><div class="font-mono text-[20px] text-text-primary sm:text-[22px]">{formatCompact(stats.totalRequests)}</div><div class="mt-1 text-[11px] text-text-placeholder">Requests</div></div>
				<div class="mt-5 border-r border-border-subtle px-3 first:pl-0 sm:mt-0 sm:px-5"><div class="font-mono text-[20px] text-text-primary sm:text-[22px]">{stats.activeDays}</div><div class="mt-1 text-[11px] text-text-placeholder">Active days</div></div>
				<div class="mt-5 px-3 sm:mt-0 sm:pl-5"><div class="font-mono text-[20px] text-text-primary sm:text-[22px]">{stats.currentStreak}</div><div class="mt-1 text-[11px] text-text-placeholder">Current streak</div></div>
			</section>

			<section class="border-b border-border-subtle py-7">
				<div class="mb-4 flex items-center justify-between gap-4">
					<h2 class="text-[13px] font-medium text-text-primary">Daily activity</h2>
					<div class="flex items-center gap-1.5 text-[10px] text-text-placeholder"><span>Less</span>{#each [0, 1, 2, 3, 4] as level}<span class="heat-cell" data-level={level}></span>{/each}<span>More</span></div>
				</div>
				<div class="heatmap-scroll overflow-x-auto pb-1">
					<div class="heatmap" style:--weeks={heatmapDays.length / 7} role="img" aria-label={`Daily activity over the last ${selectedDays} days`}>
						{#each heatmapDays as day, index (day?.date ?? `blank-${index}`)}
							{#if day}<div class="heat-cell" data-level={heatLevel(day)} title={dayTitle(day)}></div>{:else}<div></div>{/if}
						{/each}
					</div>
				</div>
				{#if stats.totalRequests === 0}<p class="mt-4 text-[12px] text-text-placeholder">Activity will appear here after your first request.</p>{/if}
			</section>

			<div class="grid gap-8 py-7 md:grid-cols-2 md:gap-12">
				<section>
					<h2 class="mb-4 text-[13px] font-medium text-text-primary">Highlights</h2>
					<dl class="space-y-3 text-[12px]">
						<div class="flex items-baseline justify-between gap-4"><dt class="text-text-tertiary">Longest streak</dt><dd class="font-mono text-text-secondary">{stats.longestStreak} days</dd></div>
						<div class="flex items-baseline justify-between gap-4"><dt class="text-text-tertiary">Peak day</dt><dd class="text-right font-mono text-text-secondary">{stats.peakDay ? `${formatDay(stats.peakDay.date)} · ${formatCompact(stats.peakDay.tokens)}` : "—"}</dd></div>
						<div class="flex items-baseline justify-between gap-4"><dt class="text-text-tertiary">Success rate</dt><dd class="font-mono text-text-secondary">{stats.successRate === null ? "—" : `${(stats.successRate * 100).toFixed(1)}%`}</dd></div>
						<div class="flex items-baseline justify-between gap-4"><dt class="text-text-tertiary">Official cost</dt><dd class="font-mono text-text-secondary">{formatCost(stats.totalCost)}</dd></div>
						<div class="flex items-baseline justify-between gap-4"><dt class="text-text-tertiary">Generation requests</dt><dd class="font-mono text-text-secondary">{formatCompact(stats.totalGenerationRequests)}</dd></div>
					</dl>
				</section>
				<section>
					<h2 class="mb-4 text-[13px] font-medium text-text-primary">Token mix</h2>
					<div class="mb-4 flex h-1.5 overflow-hidden rounded-full bg-bg-hover" aria-hidden="true">
						{#if tokenTotal > 0}
							<div class="bg-brand" style:width={`${stats.inputTokens / tokenTotal * 100}%`}></div>
							<div class="bg-text-secondary" style:width={`${stats.outputTokens / tokenTotal * 100}%`}></div>
							<div class="bg-status-running" style:width={`${stats.cacheReadTokens / tokenTotal * 100}%`}></div>
							<div class="bg-text-placeholder" style:width={`${stats.cacheWriteTokens / tokenTotal * 100}%`}></div>
						{/if}
					</div>
					<dl class="space-y-3 text-[12px]">
						<div class="flex items-center justify-between gap-4"><dt class="flex items-center gap-2 text-text-tertiary"><span class="h-1.5 w-1.5 rounded-full bg-brand"></span>Input</dt><dd class="font-mono text-text-secondary">{formatCompact(stats.inputTokens)}</dd></div>
						<div class="flex items-center justify-between gap-4"><dt class="flex items-center gap-2 text-text-tertiary"><span class="h-1.5 w-1.5 rounded-full bg-text-secondary"></span>Output</dt><dd class="font-mono text-text-secondary">{formatCompact(stats.outputTokens)}</dd></div>
						<div class="flex items-center justify-between gap-4"><dt class="flex items-center gap-2 text-text-tertiary"><span class="h-1.5 w-1.5 rounded-full bg-status-running"></span>Cache read</dt><dd class="font-mono text-text-secondary">{formatCompact(stats.cacheReadTokens)}</dd></div>
						<div class="flex items-center justify-between gap-4"><dt class="flex items-center gap-2 text-text-tertiary"><span class="h-1.5 w-1.5 rounded-full bg-text-placeholder"></span>Cache write</dt><dd class="font-mono text-text-secondary">{formatCompact(stats.cacheWriteTokens)}</dd></div>
					</dl>
				</section>
			</div>

			{#if loadError}<p class="border-t border-border-subtle pt-4 text-[11px] text-text-placeholder">Showing saved activity. Refresh failed.</p>{/if}
		{/if}
	</div>
</div>

<style>
	.heatmap-scroll {
		direction: rtl;
	}
	.heatmap {
		direction: ltr;
		display: grid;
		grid-auto-flow: column;
		grid-template-rows: repeat(7, 11px);
		grid-template-columns: repeat(var(--weeks), 11px);
		gap: 3px;
		min-width: max-content;
	}
	.heat-cell {
		display: inline-block;
		width: 11px;
		height: 11px;
		border-radius: 2px;
		background: var(--bg-hover);
	}
	.heat-cell[data-level="1"] { background: color-mix(in srgb, var(--brand) 24%, var(--bg-primary)); }
	.heat-cell[data-level="2"] { background: color-mix(in srgb, var(--brand) 42%, var(--bg-primary)); }
	.heat-cell[data-level="3"] { background: color-mix(in srgb, var(--brand) 66%, var(--bg-primary)); }
	.heat-cell[data-level="4"] { background: var(--brand); }
	@media (min-width: 640px) {
		.heatmap { grid-template-rows: repeat(7, 13px); grid-template-columns: repeat(var(--weeks), 13px); gap: 4px; }
		.heat-cell { width: 13px; height: 13px; }
	}
</style>
