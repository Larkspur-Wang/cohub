<script lang="ts">
import type { BillingCatalogProduct } from "@neta-art/cohub";
import { Check, ChevronRight, Loader2 } from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { signInWithRedirectPath } from "$lib/auth";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";

type PlanInterval = "monthly" | "yearly";

let freePlan = $state<BillingCatalogProduct | null>(null);
let monthlyPlans = $state<BillingCatalogProduct[]>([]);
let yearlyPlans = $state<BillingCatalogProduct[]>([]);
let packs = $state<BillingCatalogProduct[]>([]);
let catalogLoading = $state(true);
let catalogError = $state("");
let checkoutBusyKey = $state<string | null>(null);
let checkoutError = $state("");
let interval = $state<PlanInterval>("monthly");

const pricingReturnPath = $derived(`${page.url.pathname}${page.url.search}`);
const hasYearly = $derived(yearlyPlans.length > 0);
const visiblePlans = $derived.by(() => {
	const paid = interval === "yearly" && hasYearly ? yearlyPlans : monthlyPlans;
	return freePlan ? [freePlan, ...paid] : paid;
});

function sortByPrice(products: BillingCatalogProduct[]) {
	return [...products].sort(
		(a, b) => a.pricing.amountMinor - b.pricing.amountMinor,
	);
}

function formatUsd(value: number): string {
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
		maximumFractionDigits: 2,
	})}`;
}

function getBalance(product: BillingCatalogProduct): number {
	if (product.display.creditBenefits.length > 0) {
		return product.display.creditBenefits.reduce(
			(sum, b) => sum + b.periodAmountUsd,
			0,
		);
	}
	if (product.display.creditsAmount && product.display.creditsAmount > 0) {
		return product.display.creditsAmount * 0.00000001;
	}
	return product.pricing.amountUsd;
}

function getMultiplier(product: BillingCatalogProduct): string | null {
	const balance = getBalance(product);
	const price = product.pricing.amountUsd;
	if (price <= 0 || balance <= price * 1.005) return null;
	return `${(balance / price).toFixed(2)}×`;
}

function getAnnualNote(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	const annual = product.pricing.amountUsd;
	const monthly = annual / 12;
	return `${formatUsd(annual)} billed yearly · ${formatUsd(monthly)}/mo`;
}

// Yearly savings, derived from catalog data rather than hardcoded.
const yearlySavingsLabel = $derived.by(() => {
	for (const plan of yearlyPlans) {
		const discount = getDiscount(plan);
		if (discount) return discount;
		// Compare a paired monthly plan's annualized price to the yearly price.
		const monthly = monthlyPlans.find(
			(m) => getBalance(m) === getBalance(plan),
		);
		if (monthly && monthly.pricing.amountUsd > 0) {
			const annualized = monthly.pricing.amountUsd * 12;
			const saved = annualized - plan.pricing.amountUsd;
			if (saved > 0) {
				const freeMonths = Math.round(saved / monthly.pricing.amountUsd);
				if (freeMonths >= 1)
					return `${freeMonths} month${freeMonths === 1 ? "" : "s"} free`;
				return `Save ${formatUsd(saved)}`;
			}
		}
	}
	return null;
});

function formatValidity(days: number): string {
	if (days % 365 === 0) {
		const years = days / 365;
		return `Valid for ${years} year${years === 1 ? "" : "s"}`;
	}
	if (days % 30 === 0) {
		const months = days / 30;
		return `Valid for ${months} month${months === 1 ? "" : "s"}`;
	}
	return `Valid for ${days} day${days === 1 ? "" : "s"}`;
}

function getPackValidity(product: BillingCatalogProduct): string | null {
	const days = [
		...new Set(
			product.display.creditBenefits.map((b) => b.expiresInDays ?? null),
		),
	];
	if (days.length === 1) {
		const [only] = days;
		return only === null ? "No expiration" : formatValidity(only);
	}
	return null;
}

// Shared validity across all packs, for the section subtitle.
const packsValidityLabel = $derived.by(() => {
	const labels = new Set(
		packs.map((p) => getPackValidity(p)).filter((v): v is string => v !== null),
	);
	return labels.size === 1 ? [...labels][0] : null;
});

function getDiscount(product: BillingCatalogProduct): string | null {
	const label = product.pricing.discountLabel?.trim();
	if (label && !["none", "no discount", "null"].includes(label.toLowerCase()))
		return label;
	if (
		typeof product.pricing.discountRate === "number" &&
		product.pricing.discountRate > 0
	)
		return `${Math.round(product.pricing.discountRate * 100)}% off`;
	return null;
}

function isRecommended(product: BillingCatalogProduct): boolean {
	const key = product.key.toLowerCase();
	return key.includes("pro") || key.includes("standard");
}

function isFree(product: BillingCatalogProduct): boolean {
	return product.pricing.amountUsd === 0;
}

function getBenefits(product: BillingCatalogProduct): string[] {
	if (product.display.benefits.length > 0)
		return product.display.benefits.slice(0, 4);
	const balance = getBalance(product);
	const lines: string[] = [`${formatUsd(balance)} usage balance / cycle`];
	if (product.display.description) lines.push(product.display.description);
	return lines;
}

async function loadCatalog() {
	catalogLoading = true;
	try {
		catalogError = "";
		const { catalog } = await sdk.billing.getCatalog();
		if (!catalog.billing.configured) {
			catalogError = "Pricing is not available yet.";
			return;
		}
		freePlan = catalog.plans.find((p) => isFree(p)) ?? null;
		const freeKey = freePlan?.key;
		monthlyPlans = sortByPrice(
			catalog.plans.filter(
				(p) => p.interval === "monthly" && p.key !== freeKey,
			),
		);
		yearlyPlans = sortByPrice(
			catalog.plans.filter((p) => p.interval === "yearly" && p.key !== freeKey),
		);
		packs = sortByPrice(catalog.addons);
		// Default to yearly if available
		if (yearlyPlans.length > 0) interval = "yearly";
	} catch (error) {
		catalogError = "Failed to load pricing.";
		console.warn("[pricing] Failed to load billing catalog", error);
	} finally {
		catalogLoading = false;
	}
}

async function startCheckout(product: BillingCatalogProduct) {
	if (isFree(product)) {
		await authStore.ensureLoaded();
		if (!authStore.isAuthenticated) {
			await signInWithRedirectPath("/");
			return;
		}
		await goto("/");
		return;
	}
	if (!product.key) {
		await signInWithRedirectPath(
			`/settings/billing?tab=${product.kind === "plan" ? "plans" : "addons"}`,
		);
		return;
	}
	await authStore.ensureLoaded();
	if (!authStore.isAuthenticated) {
		await signInWithRedirectPath(pricingReturnPath);
		return;
	}
	checkoutBusyKey = product.key;
	checkoutError = "";
	try {
		const input = { returnUrl: `${window.location.origin}/settings/billing` };
		const { checkout } =
			product.kind === "plan"
				? await sdk.billing.subscribePlan(product.key, input)
				: await sdk.billing.purchaseAddon(product.key, input);
		if (checkout.checkoutUsable && checkout.checkoutUrl) {
			window.location.href = checkout.checkoutUrl;
			return;
		}
		checkoutError =
			checkout.payment.reason ??
			checkout.message ??
			"Checkout is not available";
	} catch (error) {
		checkoutError = "Checkout is not available right now.";
		console.warn("[pricing] Failed to start checkout", error);
	} finally {
		checkoutBusyKey = null;
	}
}

onMount(() => {
	void loadCatalog();
});
</script>

<svelte:head>
	<title>Pricing — Cohub</title>
	<meta name="description" content="Simple, transparent pricing for Cohub agent work." />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
	<!-- Header -->
	<header class="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
		<a href="/" class="flex items-center gap-2" aria-label="Cohub home">
			<div class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand text-[12px] font-semibold text-brand-contrast-fg">C</div>
			<span class="text-[13px] font-semibold tracking-tight">Cohub</span>
		</a>
		<nav class="flex items-center gap-3 text-[12px] text-text-tertiary">
			<a href="/explore?view=wall" class="hidden transition-colors hover:text-text-secondary sm:inline">Explore</a>
			<a href="/settings/billing" class="transition-colors hover:text-text-secondary">Billing</a>
			<a href="/" class="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
				Open app
				<ChevronRight class="h-3.5 w-3.5" />
			</a>
		</nav>
	</header>

	<main class="mx-auto w-full max-w-5xl px-5 pb-20 pt-10 sm:px-8 sm:pt-16">
		<!-- Hero -->
		<div class="mb-12">
			<h1 class="text-[clamp(32px,6vw,60px)] font-semibold leading-[1.0] tracking-[-0.05em] text-text-primary">
				Pay for what your agents<br class="hidden sm:block" /> actually use.
			</h1>
			<p class="mt-4 text-[15px] leading-relaxed text-text-secondary">
				Usage balance, not tokens. Plans for recurring work, packs to top up anytime.
			</p>
			<p class="mt-2 text-[12px] text-text-tertiary">
				Every account includes a small free monthly balance.
			</p>
		</div>

		{#if checkoutError}
			<div class="mb-6 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{checkoutError}</div>
		{/if}

		{#if catalogError}
			<div class="mb-6 rounded-[6px] border border-border-subtle bg-bg-subtle px-3 py-2 text-[12px] text-text-tertiary">{catalogError}</div>
		{/if}

		<!-- Plans -->
		<section id="plans">
			<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 class="text-[15px] font-semibold tracking-tight">Plans</h2>
				{#if !catalogLoading}
					<div class="inline-flex rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
						<button
							type="button"
							onclick={() => (interval = "monthly")}
							class="rounded-[5px] px-3 py-1.5 transition-colors {interval === 'monthly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}"
						>Monthly</button>
						<button
							type="button"
							onclick={() => (interval = "yearly")}
							disabled={!hasYearly}
							class="relative rounded-[5px] px-3 py-1.5 transition-colors {interval === 'yearly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-40"
						>
							Yearly
							{#if hasYearly && yearlySavingsLabel}
								<span class="ml-1.5 rounded-[4px] bg-brand/15 px-1 py-0.5 text-[10px] font-medium text-brand">{yearlySavingsLabel}</span>
							{/if}
						</button>
					</div>
				{/if}
			</div>

			{#if catalogLoading}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each [1, 2, 3, 4] as i (i)}
						<div class="h-64 animate-pulse rounded-[8px] bg-bg-hover-strong"></div>
					{/each}
				</div>
			{:else if visiblePlans.length === 0}
				<div class="rounded-[6px] border border-border-subtle bg-bg-subtle px-4 py-5 text-[13px] text-text-tertiary">No plans available.</div>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each visiblePlans as product (product.key)}
						{@const recommended = isRecommended(product)}
						{@const free = isFree(product)}
						{@const balance = getBalance(product)}
						{@const multiplier = getMultiplier(product)}
						{@const annualNote = getAnnualNote(product)}
						{@const discount = getDiscount(product)}
						<div class="relative flex flex-col rounded-[8px] border px-4 py-4 transition-colors {recommended ? 'border-brand/50 bg-bg-content' : 'border-border-subtle bg-bg-content hover:border-border-strong'}">
							{#if recommended}
								<div class="absolute -top-px left-4 right-4 h-px bg-brand/60"></div>
								<span class="absolute -top-2.5 left-4 rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-contrast-fg">Most popular</span>
							{/if}

							<div class="mt-1">
								<h3 class="text-[13px] font-semibold text-text-primary">{product.name}</h3>
								{#if product.display.description}
									<p class="mt-1 text-[11px] leading-[1.5] text-text-tertiary">{product.display.description}</p>
								{/if}
							</div>

							<div class="mt-4">
								<div class="flex items-baseline gap-1">
									<span class="text-[26px] font-semibold tracking-tight text-text-primary">{formatUsd(product.pricing.amountUsd)}</span>
									{#if !free}
										<span class="text-[12px] text-text-tertiary">/ {product.interval === "yearly" ? "yr" : "mo"}</span>
									{/if}
								</div>
								{#if annualNote}
									<p class="mt-0.5 text-[11px] text-text-tertiary">{annualNote}</p>
								{/if}
								{#if discount}
									<span class="mt-1.5 inline-block rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary">{discount}</span>
								{/if}
								<div class="mt-2 text-[12px] text-text-secondary">
									{#if free}
										{formatUsd(balance)} usage balance / month
									{:else}
										{formatUsd(balance)} balance / cycle
										{#if multiplier}
											<span class="ml-1 text-[11px] text-text-tertiary">({multiplier} value)</span>
										{/if}
									{/if}
								</div>
							</div>

							<ul class="mt-4 flex-1 space-y-1.5">
								{#each getBenefits(product) as benefit}
									<li class="flex items-start gap-2 text-[12px] text-text-tertiary">
										<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
										<span>{benefit}</span>
									</li>
								{/each}
							</ul>

							<button
								type="button"
								onclick={() => startCheckout(product)}
								disabled={checkoutBusyKey !== null}
								class="mt-5 inline-flex h-8 w-full items-center justify-center rounded-[6px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50
									{recommended
										? 'bg-brand text-brand-contrast-fg hover:bg-brand-hover'
										: free
											? 'border border-border-subtle bg-bg-input text-text-secondary hover:bg-bg-hover hover:text-text-primary'
											: 'border border-border-subtle bg-bg-input text-text-primary hover:bg-bg-hover'}"
							>
								{#if checkoutBusyKey === product.key}
									<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
									Processing
								{:else if free}
									Get started free
								{:else}
									Subscribe
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Balance Packs -->
		<section id="packs" class="mt-14">
			<div class="mb-5">
				<h2 class="text-[15px] font-semibold tracking-tight">Balance Packs</h2>
				<p class="mt-1 text-[13px] text-text-tertiary">Top up without changing your plan.{#if packsValidityLabel} {packsValidityLabel}.{/if}</p>
			</div>

			{#if catalogLoading}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each [1, 2, 3, 4] as i (i)}
						<div class="h-44 animate-pulse rounded-[8px] bg-bg-hover-strong"></div>
					{/each}
				</div>
			{:else if packs.length === 0}
				<div class="rounded-[6px] border border-border-subtle bg-bg-subtle px-4 py-5 text-[13px] text-text-tertiary">No balance packs available.</div>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each packs as product (product.key)}
						{@const balance = getBalance(product)}
						{@const multiplier = getMultiplier(product)}
						{@const packRecommended = isRecommended(product)}
						{@const validity = packsValidityLabel ? null : getPackValidity(product)}
						<div class="relative flex flex-col rounded-[8px] border px-4 py-4 transition-colors {packRecommended ? 'border-brand/40 bg-bg-content' : 'border-border-subtle bg-bg-content hover:border-border-strong'}">
							{#if packRecommended}
								<div class="absolute -top-px left-4 right-4 h-px bg-brand/60"></div>
							{/if}
							<div class="flex items-start justify-between gap-2">
								<h3 class="text-[13px] font-semibold text-text-primary">{product.name}</h3>
								{#if multiplier}
									<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-tertiary">{multiplier}</span>
								{/if}
							</div>
							<div class="mt-3">
								<div class="text-[24px] font-semibold tracking-tight text-text-primary">{formatUsd(product.pricing.amountUsd)}</div>
								<div class="mt-1 text-[12px] text-text-secondary">Get {formatUsd(balance)} balance</div>
							</div>
							{#if product.display.description}
								<p class="mt-2 text-[11px] leading-[1.5] text-text-tertiary">{product.display.description}</p>
							{/if}
							{#if validity}
								<p class="mt-2 text-[11px] text-text-tertiary">{validity}</p>
							{/if}
							<button
								type="button"
								onclick={() => startCheckout(product)}
								disabled={checkoutBusyKey !== null}
								class="mt-auto pt-4 inline-flex h-8 w-full items-center justify-center rounded-[6px] border border-border-subtle bg-bg-input text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
							>
								{#if checkoutBusyKey === product.key}
									<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
									Processing
								{:else}
									Purchase
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Fine print -->
		<p class="mt-14 border-t border-border-subtle pt-6 text-[11px] leading-6 text-text-placeholder">
			Usage balance is applied to Cohub services and cannot be withdrawn. Balance nearest expiration is consumed first. Monthly plan balance resets each cycle and does not roll over. Each pack's validity is shown on the pack.
		</p>
	</main>
</div>
