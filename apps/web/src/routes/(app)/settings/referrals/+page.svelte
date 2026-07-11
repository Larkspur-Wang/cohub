<script lang="ts">
import type { ReferralDashboard } from "@neta-art/cohub";
import { Check, Copy, Gift, Loader2, RefreshCw, Share2 } from "lucide-svelte";
import { onMount } from "svelte";
import UserAvatar from "$lib/components/UserAvatar.svelte";
import { sdk } from "$lib/sdk";

let dashboard = $state<ReferralDashboard | null>(null);
let loading = $state(true);
let loadError = $state("");
let copied = $state(false);
let copyError = $state("");
let rotating = $state(false);
let rotateError = $state("");
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const referralUrl = $derived(
	dashboard && typeof window !== "undefined"
		? `${window.location.origin}/referrals/${dashboard.code}`
		: "",
);
const canShare = $derived(
	typeof navigator !== "undefined" && typeof navigator.share === "function",
);

function formatDate(value: string) {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}

async function loadReferrals() {
	loading = true;
	loadError = "";
	try {
		dashboard = await sdk.referrals.getMine();
	} catch (error) {
		loadError =
			error instanceof Error ? error.message : "Failed to load referrals";
	} finally {
		loading = false;
	}
}

async function copyLink() {
	if (!referralUrl) return;
	copyError = "";
	try {
		await navigator.clipboard.writeText(referralUrl);
		copied = true;
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => {
			copied = false;
		}, 2000);
	} catch {
		copyError = "Could not copy the link. Select and copy it manually.";
	}
}

async function shareLink() {
	if (!dashboard || !referralUrl) return;
	if (!canShare) {
		await copyLink();
		return;
	}
	try {
		await navigator.share({
			title: "Try Cohub",
			text: `Get ${dashboard.reward.inviteeUsd} in Cohub credits when you get started.`,
			url: referralUrl,
		});
	} catch (error) {
		if ((error as { name?: string }).name !== "AbortError") {
			copyError = "Could not share the link. Try copying it instead.";
		}
	}
}

async function rotateLink() {
	if (
		rotating ||
		!confirm("Replace your referral link? The current link will stop working.")
	)
		return;
	rotating = true;
	rotateError = "";
	try {
		const result = await sdk.referrals.rotateCode();
		if (dashboard) dashboard = { ...dashboard, code: result.code };
	} catch (error) {
		rotateError =
			error instanceof Error
				? error.message
				: "Failed to replace referral link";
	} finally {
		rotating = false;
	}
}

onMount(() => {
	void loadReferrals();
});
</script>

<svelte:head><title>Referrals — Cohub</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex-1 px-4 py-6 sm:px-6 sm:py-7">
		<section class="max-w-2xl">
			<header class="border-b border-border-subtle pb-5">
				<h1 class="text-[18px] font-semibold tracking-tight text-text-primary">Referrals</h1>
				<p class="mt-1 max-w-xl text-[13px] leading-5 text-text-tertiary">Share Cohub with people you build with.</p>
			</header>

			{#if loading}
				<div class="flex h-44 items-center justify-center text-text-tertiary"><Loader2 class="h-4 w-4 animate-spin" /><span class="ml-2 text-[12px]">Loading referrals…</span></div>
			{:else if loadError || !dashboard}
				<div class="py-8">
					<p class="text-[13px] text-error-soft">{loadError || "Failed to load referrals."}</p>
					<button type="button" class="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary" onclick={() => void loadReferrals()}><RefreshCw class="h-3.5 w-3.5" />Retry</button>
				</div>
			{:else}
				<div class="py-6">
					<div class="flex items-start gap-3">
						<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-brand-muted text-brand"><Gift class="h-4 w-4" /></div>
						<div>
							<h2 class="text-[16px] font-semibold tracking-tight text-text-primary">Give ${dashboard.reward.inviteeUsd}, get ${dashboard.reward.inviterUsd}</h2>
							<p class="mt-1 max-w-lg text-[12px] leading-5 text-text-tertiary">You both get credits when your referral gets started.</p>
						</div>
					</div>

					<div class="mt-5 flex flex-col gap-2 sm:flex-row">
						<div class="flex h-9 min-w-0 flex-1 items-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5"><code class="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{referralUrl}</code></div>
						<div class="flex gap-2">
							<button type="button" class="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[5px] bg-brand px-3 text-[12px] font-medium text-brand-contrast-fg hover:bg-brand-hover sm:flex-none" onclick={() => void copyLink()}>{#if copied}<Check class="h-3.5 w-3.5" />Copied{:else}<Copy class="h-3.5 w-3.5" />Copy link{/if}</button>
							<button type="button" class="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[5px] border border-border-subtle px-3 text-[12px] text-text-secondary hover:bg-bg-hover sm:flex-none" onclick={() => void shareLink()}><Share2 class="h-3.5 w-3.5" />Share</button>
						</div>
					</div>
					{#if copyError}<p class="mt-2 text-[11px] text-error-soft">{copyError}</p>{/if}

					<div class="mt-6 flex gap-8 border-y border-border-subtle py-4">
						<div><div class="font-mono text-[17px] font-semibold text-text-primary">{dashboard.summary.rewarded}</div><div class="mt-0.5 text-[11px] text-text-tertiary">Successful referrals</div></div>
						<div><div class="font-mono text-[17px] font-semibold text-text-primary">${dashboard.summary.earnedUsd}</div><div class="mt-0.5 text-[11px] text-text-tertiary">Credits earned</div></div>
					</div>
				</div>

				<section>
					<div class="flex items-center justify-between pb-3">
						<h2 class="text-[13px] font-medium text-text-primary">Referrals <span class="font-normal text-text-tertiary">· {dashboard.summary.total}</span></h2>
						<button type="button" disabled={rotating} class="inline-flex h-8 items-center gap-1.5 rounded-[5px] px-2 text-[11px] text-text-tertiary hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50" onclick={() => void rotateLink()}>{#if rotating}<Loader2 class="h-3 w-3 animate-spin" />{:else}<RefreshCw class="h-3 w-3" />{/if}Replace link</button>
					</div>
					{#if rotateError}<p class="mb-3 text-[12px] text-error-soft">{rotateError}</p>{/if}
					{#if dashboard.items.length === 0}
						<div class="border-t border-border-subtle py-8 text-center"><p class="text-[12px] text-text-tertiary">No referrals yet.</p><p class="mt-1 text-[11px] text-text-placeholder">Share your link to get started.</p></div>
					{:else}
						<div class="divide-y divide-border-subtle border-y border-border-subtle">
							{#each dashboard.items as item (item.id)}
								<div class="flex min-h-14 items-center gap-3 py-2.5">
									<UserAvatar name={item.profile?.displayName || "Cohub user"} avatarUrl={item.profile?.avatarUrl} size="sm" class="shrink-0" />
									<div class="min-w-0 flex-1"><div class="truncate text-[12px] font-medium text-text-primary">{item.profile?.displayName || "Cohub user"}</div><div class="mt-0.5 truncate text-[10px] text-text-placeholder">{item.profile?.username ? `@${item.profile.username} · ` : ""}Joined {formatDate(item.claimedAt)}</div></div>
									<span class="shrink-0 text-[11px] {item.status === 'rewarded' ? 'text-status-running' : 'text-text-tertiary'}">{item.status === "rewarded" ? "Rewarded" : item.status === "qualified" ? "Processing" : "Pending"}</span>
								</div>
							{/each}
						</div>
					{/if}
					<p class="mt-4 text-[10px] leading-4 text-text-placeholder">Credits are added automatically after your referral becomes active. New users only.</p>
				</section>
			{/if}
		</section>
	</div>
</div>
