<script lang="ts">
import type {
	BillingCreditStatus,
	BillingOpenOverageList,
	BillingUsageRecordList,
} from "@neta-art/cohub";
import {
	AlertCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	CreditCard,
	Loader2,
	ReceiptText,
	RefreshCw,
	Wallet,
} from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { sdk } from "$lib/sdk";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);

let balanceCredit = $state<BillingCreditStatus | null>(null);
let balanceOverages = $state<BillingOpenOverageList | null>(null);
let balanceUsage = $state<BillingUsageRecordList | null>(null);
let creditLoading = $state(true);
let overageLoading = $state(true);
let usageLoading = $state(true);
let creditError = $state("");
let overageError = $state("");
let usageError = $state("");
let overagePage = $state(1);
let usagePage = $state(1);
let creditRequest: Promise<void> | null = null;
let overageRequest: Promise<void> | null = null;
let usageRequest: Promise<void> | null = null;

const balanceConfigured = $derived(
	balanceCredit?.billing.configured ??
		balanceOverages?.billing.configured ??
		balanceUsage?.billing.configured ??
		true,
);
const overageTotalPages = $derived(
	Math.max(1, balanceOverages?.pagination.maxPage ?? 1),
);
const usageTotalPages = $derived(
	Math.max(1, balanceUsage?.pagination.maxPage ?? 1),
);
const anyBalanceLoading = $derived(
	creditLoading || overageLoading || usageLoading,
);

function formatUsdAmount(value: number): string {
	const sign = value < 0 ? "-" : "";
	const absolute = Math.abs(value);
	return `${sign}$${absolute.toLocaleString("en-US", {
		minimumFractionDigits: 8,
		maximumFractionDigits: 8,
	})}`;
}

function formatBillingDate(value: string | null | undefined): string {
	if (!value) return "No expiration";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function formatUsageType(value: string | null): string {
	if (!value) return "Usage";
	return value
		.split(/[._-]/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function shortIdentifier(value: string | null): string {
	if (!value) return "";
	if (value.length <= 18) return value;
	return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function grantConsumedPercent(value: number | null): number {
	if (value === null || !Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

function formatGrantStatus(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function getGrantDisplayStatus(grant: {
	status: string;
	daysRemaining: number | null;
}): string {
	if (grant.daysRemaining !== null && grant.daysRemaining <= 0)
		return "Expired";
	return formatGrantStatus(grant.status);
}

function isGrantDisplayActive(grant: {
	status: string;
	daysRemaining: number | null;
}): boolean {
	return (
		grant.status === "active" &&
		!(grant.daysRemaining !== null && grant.daysRemaining <= 0)
	);
}

async function loadCreditStatus() {
	if (creditRequest) return creditRequest;
	creditLoading = true;
	creditError = "";
	creditRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const { credit } = await sdk.billing.getCredits();
			balanceCredit = credit;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			creditError =
				error instanceof Error ? error.message : "Failed to load balance";
			console.error("[balance] Failed to load credit status:", error);
		} finally {
			creditLoading = false;
			creditRequest = null;
		}
	})();
	return creditRequest;
}

async function loadOveragesPage(page = overagePage) {
	if (overageRequest) return overageRequest;
	overageLoading = true;
	overageError = "";
	overageRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const nextPage = Math.max(1, Math.floor(page));
			const { overages } = await sdk.billing.getOverages({
				page: nextPage,
				limit: 10,
			});
			balanceOverages = overages;
			overagePage = overages.page;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			overageError =
				error instanceof Error ? error.message : "Failed to load overages";
			console.error("[balance] Failed to load open overages:", error);
		} finally {
			overageLoading = false;
			overageRequest = null;
		}
	})();
	return overageRequest;
}

async function loadUsagePage(page = usagePage) {
	if (usageRequest) return usageRequest;
	usageLoading = true;
	usageError = "";
	usageRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const nextPage = Math.max(1, Math.floor(page));
			const { usage } = await sdk.billing.getUsageRecords({
				page: nextPage,
				limit: 10,
			});
			balanceUsage = usage;
			usagePage = usage.page;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			usageError =
				error instanceof Error ? error.message : "Failed to load usage records";
			console.error("[balance] Failed to load usage records:", error);
		} finally {
			usageLoading = false;
			usageRequest = null;
		}
	})();
	return usageRequest;
}

function refreshBalance() {
	void loadCreditStatus();
	void loadOveragesPage(overagePage);
	void loadUsagePage(usagePage);
}

function goToOveragePage(page: number) {
	if (overageLoading) return;
	void loadOveragesPage(page);
}

function goToUsagePage(page: number) {
	if (usageLoading) return;
	void loadUsagePage(page);
}

onMount(() => {
	void loadCreditStatus();
	void loadOveragesPage();
	void loadUsagePage();
});
</script>

<svelte:head>
	<title>Balance — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<div class="flex-1 overflow-y-auto px-6 py-7">
		<section class="max-w-4xl">
			<div class="flex flex-col gap-3 border-b border-border-subtle pb-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Balance</h1>
					<p class="mt-1 max-w-xl text-[13px] leading-5 text-text-tertiary">Credit balance, expiration buckets, overage state, and recent usage.</p>
				</div>
				<button type="button" onclick={refreshBalance} disabled={anyBalanceLoading} class="inline-flex w-fit items-center gap-1.5 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" title="Refresh balance">
					{#if anyBalanceLoading}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<RefreshCw class="h-3.5 w-3.5" />{/if}
					<span>Refresh</span>
				</button>
			</div>

			{#if creditError}
				<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span class="break-all">{creditError}</span>
				</div>
			{/if}

			{#if creditLoading && !balanceCredit}
				<div class="grid gap-3 py-5 sm:grid-cols-3">
					<div class="h-20 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					<div class="h-20 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					<div class="h-20 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
				</div>
			{:else if !balanceConfigured}
				<div class="py-6 text-[13px] text-text-tertiary">Billing is not available in this environment.</div>
			{:else if balanceCredit}
				<div class="grid gap-3 py-5 sm:grid-cols-3">
					<div class="rounded-[6px] border border-border-subtle px-3 py-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
							<Wallet class="h-3.5 w-3.5" />
							<span>Net Balance</span>
						</div>
						<div class="mt-2 font-mono text-[20px] font-semibold tracking-tight {balanceCredit.balance.netUsd < 0 ? 'text-error-soft' : 'text-text-primary'}">{formatUsdAmount(balanceCredit.balance.netUsd)}</div>
					</div>
					<div class="rounded-[6px] border border-border-subtle px-3 py-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
							<CreditCard class="h-3.5 w-3.5" />
							<span>Available</span>
						</div>
						<div class="mt-2 font-mono text-[20px] font-semibold tracking-tight text-text-primary">{formatUsdAmount(balanceCredit.balance.availableUsd)}</div>
					</div>
					<div class="rounded-[6px] border border-border-subtle px-3 py-3">
						<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
							<ReceiptText class="h-3.5 w-3.5" />
							<span>Open Overage</span>
						</div>
						<div class="mt-2 font-mono text-[20px] font-semibold tracking-tight {balanceCredit.overage.hasOpenOverage ? 'text-error-soft' : 'text-text-primary'}">{formatUsdAmount(balanceCredit.balance.openOverageUsd)}</div>
					</div>
				</div>

				<section class="border-t border-border-subtle py-5">
					<h2 class="text-[13px] font-medium text-text-primary">Credits by Expiration</h2>
					{#if balanceCredit.groups.length === 0}
						<p class="mt-3 text-[12px] text-text-tertiary">No credit grants.</p>
					{:else}
						<div class="mt-3 divide-y divide-border-subtle rounded-[6px] border border-border-subtle">
							{#each balanceCredit.groups as group (group.key)}
								<div class="px-3 py-3">
									<div class="flex min-w-0 items-center justify-between gap-3">
										<div class="min-w-0">
											<div class="truncate text-[12px] font-medium text-text-primary">{group.label}</div>
											<div class="mt-0.5 text-[11px] text-text-tertiary">{group.grants.length} grant{group.grants.length === 1 ? "" : "s"}</div>
										</div>
										<div class="shrink-0 font-mono text-[13px] text-text-primary">{formatUsdAmount(group.remainingAmountUsd)}</div>
									</div>
									<div class="mt-2 grid gap-2">
										{#each group.grants as grant (grant.id)}
											<div class="rounded-[5px] bg-bg-subtle px-2.5 py-2 text-[11px]">
												<div class="grid gap-1 sm:grid-cols-[1fr_auto]">
													<div class="min-w-0">
														<div class="flex min-w-0 items-center gap-2">
															<div class="truncate text-text-secondary">{grant.benefitName ?? grant.grantKind ?? "Credit grant"}</div>
															<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] leading-none {isGrantDisplayActive(grant) ? 'text-text-tertiary' : 'text-text-placeholder'}">{getGrantDisplayStatus(grant)}</span>
														</div>
														<div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-text-tertiary">
															<Clock class="h-3 w-3 shrink-0" />
															<span class="truncate">{formatBillingDate(grant.expiresAt)}</span>
														</div>
													</div>
													<div class="font-mono {grant.remainingAmountUsd > 0 ? 'text-text-secondary' : 'text-text-placeholder'} sm:text-right">{formatUsdAmount(grant.remainingAmountUsd)}</div>
												</div>
												<div class="mt-2">
													<div class="flex min-w-0 items-center justify-between gap-3 text-[10px]">
														<span class="truncate text-text-tertiary">
															Used {formatUsdAmount(grant.consumedAmountUsd ?? 0)}
															{#if grant.originalAmountUsd !== null}
																of {formatUsdAmount(grant.originalAmountUsd)}
															{/if}
														</span>
														<span class="shrink-0 font-mono text-text-tertiary">{grant.consumedPercent === null ? "0%" : `${grant.consumedPercent}%`}</span>
													</div>
													<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-hover-strong" aria-hidden="true">
														<div class="h-full rounded-full bg-brand/70" style={`width: ${grantConsumedPercent(grant.consumedPercent)}%`}></div>
													</div>
													{#if (grant.usageConsumedAmountUsd ?? 0) > 0 || (grant.settledOverageAmountUsd ?? 0) > 0}
														<div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-text-placeholder">
															<span>usage {formatUsdAmount(grant.usageConsumedAmountUsd ?? 0)}</span>
															{#if (grant.settledOverageAmountUsd ?? 0) > 0}
																<span>overage settled {formatUsdAmount(grant.settledOverageAmountUsd ?? 0)}</span>
															{/if}
														</div>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="border-t border-border-subtle py-5">
					<div class="flex items-center justify-between gap-3">
						<div>
							<h2 class="text-[13px] font-medium text-text-primary">Open Overage</h2>
							<p class="mt-1 text-[11px] text-text-tertiary">{balanceOverages?.pagination.totalCount ?? 0} records</p>
						</div>
						<div class="flex items-center gap-1">
							<button type="button" onclick={() => goToOveragePage(overagePage - 1)} disabled={overageLoading || overagePage <= 1} class="rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40" title="Previous page">
								<ChevronLeft class="h-3.5 w-3.5" />
							</button>
							<span class="min-w-14 text-center font-mono text-[11px] text-text-tertiary">{overagePage}/{overageTotalPages}</span>
							<button type="button" onclick={() => goToOveragePage(overagePage + 1)} disabled={overageLoading || overagePage >= overageTotalPages} class="rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40" title="Next page">
								<ChevronRight class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>

					{#if overageError}
						<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span class="break-all">{overageError}</span>
						</div>
					{:else if overageLoading && !balanceOverages}
						<div class="mt-3 h-20 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					{:else if !balanceOverages || balanceOverages.items.length === 0}
						<p class="mt-4 text-[12px] text-text-tertiary">No open overage.</p>
					{:else}
						<div class="mt-3 divide-y divide-border-subtle rounded-[6px] border border-border-subtle">
							{#each balanceOverages.items as item (item.id)}
								<div class="grid gap-2 px-3 py-3 text-[12px] sm:grid-cols-[1fr_auto]">
									<div class="min-w-0">
										<div class="truncate font-medium text-text-primary">{formatUsageType(item.usageType)}</div>
										<div class="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{shortIdentifier(item.operationId)}</div>
									</div>
									<div class="font-mono text-error-soft sm:text-right">{formatUsdAmount(item.remainingAmountUsd)}</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section class="border-t border-border-subtle py-5">
					<div class="flex items-center justify-between gap-3">
						<div>
							<h2 class="text-[13px] font-medium text-text-primary">Usage Records</h2>
							<p class="mt-1 text-[11px] text-text-tertiary">{balanceUsage?.pagination.totalCount ?? 0} records</p>
						</div>
						<div class="flex items-center gap-1">
							<button type="button" onclick={() => goToUsagePage(usagePage - 1)} disabled={usageLoading || usagePage <= 1} class="rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40" title="Previous page">
								<ChevronLeft class="h-3.5 w-3.5" />
							</button>
							<span class="min-w-14 text-center font-mono text-[11px] text-text-tertiary">{usagePage}/{usageTotalPages}</span>
							<button type="button" onclick={() => goToUsagePage(usagePage + 1)} disabled={usageLoading || usagePage >= usageTotalPages} class="rounded-[5px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-40" title="Next page">
								<ChevronRight class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>

					{#if usageError}
						<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span class="break-all">{usageError}</span>
						</div>
					{:else if usageLoading && !balanceUsage}
						<div class="mt-3 h-20 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					{:else if !balanceUsage || balanceUsage.items.length === 0}
						<p class="mt-4 text-[12px] text-text-tertiary">No usage records yet.</p>
					{:else}
						<div class="mt-3 overflow-hidden rounded-[6px] border border-border-subtle">
							<div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 border-b border-border-subtle bg-bg-subtle px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-tertiary sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_8rem]">
								<span>Usage</span>
								<span class="hidden sm:block">Operation</span>
								<span class="text-right">Amount</span>
							</div>
							<div class="divide-y divide-border-subtle">
								{#each balanceUsage.items as item (item.id)}
									<div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 px-3 py-3 text-[12px] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_8rem]">
										<div class="min-w-0">
											<div class="truncate font-medium text-text-primary">{formatUsageType(item.usageType)}</div>
											<div class="mt-0.5 text-[11px] text-text-tertiary">{formatBillingDate(item.createdAt)}</div>
											<div class="mt-1 min-w-0 sm:hidden">
												<div class="truncate font-mono text-[11px] text-text-tertiary" title={item.operationId ?? item.sourceId ?? ""}>{shortIdentifier(item.operationId ?? item.sourceId)}</div>
												<div class="mt-0.5 truncate text-[11px] text-text-placeholder">{item.reason ?? item.sourceType ?? ""}</div>
											</div>
										</div>
										<div class="hidden min-w-0 sm:block">
											<div class="truncate font-mono text-[11px] text-text-tertiary" title={item.operationId ?? item.sourceId ?? ""}>{shortIdentifier(item.operationId ?? item.sourceId)}</div>
											<div class="mt-0.5 truncate text-[11px] text-text-placeholder">{item.reason ?? item.sourceType ?? ""}</div>
										</div>
										<div class="font-mono text-[12px] text-text-primary sm:text-right">{formatUsdAmount(-Math.abs(item.amountUsd))}</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</section>
			{/if}
		</section>
	</div>
</div>
