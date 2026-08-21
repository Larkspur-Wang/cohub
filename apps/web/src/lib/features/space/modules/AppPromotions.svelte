<script lang="ts">
import type {
	AppPromotionStatsResponse,
	WorkPromotionProviderStatus,
	WorkPromotionRecord,
} from "@neta-art/cohub";
import {
	BarChart3,
	Check,
	ChevronDown,
	Copy,
	Loader2,
	Plus,
	X,
} from "lucide-svelte";
import { onMount } from "svelte";
import { sdk } from "$lib/sdk";

type Props = {
	appId: string;
	publicRoute: string;
};

let { appId, publicRoute }: Props = $props();
let promotions = $state<WorkPromotionRecord[]>([]);
let providers = $state<WorkPromotionProviderStatus[]>([]);
let selectedId = $state<string | null>(null);
let stats = $state<AppPromotionStatsResponse | null>(null);
let loading = $state(true);
let statsLoading = $state(false);
let creating = $state(false);
let createOpen = $state(false);
let error = $state("");
let copiedId = $state<string | null>(null);
let name = $state("");
let provider = $state("generic");
let utmSource = $state("");
let utmMedium = $state("");
let utmCampaign = $state("");
let utmContent = $state("");

const selected = $derived(
	promotions.find((promotion) => promotion.id === selectedId) ?? null,
);

function promotionUrl(promotion: WorkPromotionRecord) {
	const url = new URL(publicRoute, window.location.origin);
	url.searchParams.set("cohub_campaign", promotion.id);
	for (const [key, value] of Object.entries(promotion.parameters)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

async function loadPromotions() {
	loading = true;
	error = "";
	try {
		const result = await sdk.works.listPromotions(appId);
		promotions = result.promotions;
		providers = result.providers;
		selectedId =
			selectedId && promotions.some((item) => item.id === selectedId)
				? selectedId
				: (promotions[0]?.id ?? null);
	} catch (cause) {
		error =
			cause instanceof Error ? cause.message : "Failed to load promotions.";
	} finally {
		loading = false;
	}
}

async function loadStats(promotionId: string) {
	statsLoading = true;
	try {
		stats = await sdk.works.getPromotionStats(appId, promotionId);
	} catch {
		stats = null;
	} finally {
		statsLoading = false;
	}
}

$effect(() => {
	if (selectedId) void loadStats(selectedId);
	else stats = null;
});

async function createPromotion(event: SubmitEvent) {
	event.preventDefault();
	creating = true;
	error = "";
	try {
		const parameters = Object.fromEntries(
			Object.entries({
				utm_source: utmSource.trim(),
				utm_medium: utmMedium.trim(),
				utm_campaign: utmCampaign.trim(),
				utm_content: utmContent.trim(),
			}).filter(([, value]) => value.length > 0),
		);
		const result = await sdk.works.createPromotion(appId, {
			name: name.trim(),
			provider,
			parameters,
		});
		promotions = [...promotions, result.promotion];
		selectedId = result.promotion.id;
		name = "";
		utmSource = "";
		utmMedium = "";
		utmCampaign = "";
		utmContent = "";
		createOpen = false;
	} catch (cause) {
		error =
			cause instanceof Error ? cause.message : "Failed to create promotion.";
	} finally {
		creating = false;
	}
}

async function copyPromotion(promotion: WorkPromotionRecord) {
	await navigator.clipboard.writeText(promotionUrl(promotion));
	copiedId = promotion.id;
	window.setTimeout(() => {
		if (copiedId === promotion.id) copiedId = null;
	}, 1500);
}

onMount(() => {
	void loadPromotions();
});
</script>

<section class="border-b border-border-subtle/70 pb-5" aria-labelledby="app-promotions-heading">
	<div class="mb-4 flex items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<BarChart3 class="h-3.5 w-3.5 text-text-tertiary" />
			<h2 id="app-promotions-heading" class="text-[10px] font-medium uppercase tracking-[0.18em] text-text-placeholder">Promotions</h2>
		</div>
		<button
			type="button"
			class="inline-flex min-h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
			onclick={() => (createOpen = !createOpen)}
		>
			{#if createOpen}<X class="h-3.5 w-3.5" />{:else}<Plus class="h-3.5 w-3.5" />{/if}
			<span>{createOpen ? "Close" : "New promotion"}</span>
		</button>
	</div>

	{#if createOpen}
		<form class="mb-5 grid gap-3 border-b border-border-subtle/60 pb-5 lg:grid-cols-[minmax(0,1fr)_180px]" onsubmit={createPromotion}>
			<div class="space-y-1.5">
				<label for="promotion-name" class="block text-[10px] font-medium text-text-tertiary">Name</label>
				<input id="promotion-name" required maxlength="120" bind:value={name} placeholder="Meta launch creative A" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary focus:border-brand/50 focus:outline-none" />
			</div>
			<div class="space-y-1.5">
				<label for="promotion-provider" class="block text-[10px] font-medium text-text-tertiary">Provider</label>
				<select id="promotion-provider" bind:value={provider} class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary focus:border-brand/50 focus:outline-none">
					{#each providers as item (item.key)}
						<option value={item.key} disabled={!item.configured}>{item.key}{item.configured ? "" : " (unavailable)"}</option>
					{/each}
				</select>
			</div>
			<details class="group border-y border-border-subtle/60 lg:col-span-2">
				<summary class="flex min-h-9 cursor-pointer list-none items-center gap-2 py-2 text-[11px] text-text-tertiary transition-colors hover:text-text-secondary">
					<span class="font-medium">URL parameters</span>
					<span class="text-[10px] text-text-placeholder">Optional</span>
					<ChevronDown class="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
				</summary>
				<div class="grid gap-3 pb-3 pt-1 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="promotion-source" class="block text-[10px] font-medium text-text-tertiary">UTM source</label>
						<input id="promotion-source" bind:value={utmSource} placeholder="instagram" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary focus:border-brand/50 focus:outline-none" />
					</div>
					<div class="space-y-1.5">
						<label for="promotion-medium" class="block text-[10px] font-medium text-text-tertiary">UTM medium</label>
						<input id="promotion-medium" bind:value={utmMedium} placeholder="paid_social" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary focus:border-brand/50 focus:outline-none" />
					</div>
					<div class="space-y-1.5">
						<label for="promotion-campaign" class="block text-[10px] font-medium text-text-tertiary">UTM campaign</label>
						<input id="promotion-campaign" bind:value={utmCampaign} placeholder="launch_2026" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary focus:border-brand/50 focus:outline-none" />
					</div>
					<div class="space-y-1.5">
						<label for="promotion-content" class="block text-[10px] font-medium text-text-tertiary">UTM content</label>
						<input id="promotion-content" bind:value={utmContent} placeholder="video_a" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary focus:border-brand/50 focus:outline-none" />
					</div>
				</div>
			</details>
			<div class="flex justify-end lg:col-span-2">
				<button type="submit" disabled={creating || !name.trim()} class="inline-flex min-h-9 items-center gap-1.5 rounded-[5px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:opacity-50">
					{#if creating}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if}
					<span>Create</span>
				</button>
			</div>
		</form>
	{/if}

	{#if error}
		<div class="mb-4 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{error}</div>
	{/if}

	{#if loading}
		<div class="flex min-h-16 items-center text-[12px] text-text-placeholder">Loading promotions…</div>
	{:else if promotions.length === 0}
		<div class="py-3 text-[12px] text-text-placeholder">Create a tracked link for paid or owned traffic.</div>
	{:else}
		<div class="grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
			<div class="divide-y divide-border-subtle/60 border-y border-border-subtle/60">
				{#each promotions as promotion (promotion.id)}
					<div class="flex min-w-0 items-center gap-2 py-2.5">
						<button type="button" class="min-w-0 flex-1 text-left" onclick={() => (selectedId = promotion.id)}>
							<div class="truncate text-[12px] font-medium {selectedId === promotion.id ? 'text-text-primary' : 'text-text-secondary'}">{promotion.name}</div>
							<div class="mt-0.5 font-mono text-[10px] text-text-placeholder">{promotion.provider}</div>
						</button>
						<button type="button" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => void copyPromotion(promotion)} title="Copy promotion link" aria-label="Copy promotion link">
							{#if copiedId === promotion.id}<Check class="h-3.5 w-3.5 text-success-soft" />{:else}<Copy class="h-3.5 w-3.5" />{/if}
						</button>
					</div>
				{/each}
			</div>

			<div class="min-w-0">
				{#if statsLoading}
					<div class="flex min-h-20 items-center"><Loader2 class="h-4 w-4 animate-spin text-text-placeholder" /></div>
				{:else if selected && stats}
					<div class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{stats.summary.landing}</div><div class="text-[10px] text-text-placeholder">Landing</div></div>
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{stats.summary.ready}</div><div class="text-[10px] text-text-placeholder">Ready</div></div>
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{stats.summary.registrationCompleted}</div><div class="text-[10px] text-text-placeholder">Registered</div></div>
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{stats.summary.paywallViewed}</div><div class="text-[10px] text-text-placeholder">Paywall</div></div>
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{stats.summary.checkoutStarted}</div><div class="text-[10px] text-text-placeholder">Checkout</div></div>
						<div><div class="font-mono text-[18px] font-semibold text-text-primary">{(stats.summary.readyRate * 100).toFixed(1)}%</div><div class="text-[10px] text-text-placeholder">Ready rate</div></div>
					</div>
					<div class="mt-4 break-all font-mono text-[10px] leading-5 text-text-placeholder">{promotionUrl(selected)}</div>
				{:else}
					<div class="py-3 text-[12px] text-text-placeholder">Statistics are unavailable.</div>
				{/if}
			</div>
		</div>
	{/if}
</section>
