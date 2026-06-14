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
type PlanTier = "free" | "plus" | "pro" | "max" | "custom";

type PlanCopy = {
	name: string;
	description: string;
	features: string[];
};

let freePlan = $state<BillingCatalogProduct | null>(null);
let monthlyPlans = $state<BillingCatalogProduct[]>([]);
let yearlyPlans = $state<BillingCatalogProduct[]>([]);
let packs = $state<BillingCatalogProduct[]>([]);
let catalogLoading = $state(true);
let catalogError = $state("");
let checkoutBusyKey = $state<string | null>(null);
let checkoutError = $state("");
let interval = $state<PlanInterval>("monthly");

const CHECKOUT_BUTTON_BASE =
	"inline-flex h-10 w-full items-center justify-center rounded-[6px] text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const CHECKOUT_BUTTON_PRIMARY =
	"bg-brand text-brand-contrast-fg hover:bg-brand-hover";
const CHECKOUT_BUTTON_SECONDARY =
	"border border-border-subtle bg-bg-input text-text-primary hover:bg-bg-hover";
const CHECKOUT_BUTTON_SECONDARY_MUTED =
	"border border-border-subtle bg-bg-primary text-text-secondary hover:bg-bg-hover hover:text-text-primary";
const PRICING_CARD_BASE =
	"relative flex min-h-[344px] flex-col rounded-[10px] border bg-bg-content px-5 py-5 transition-colors";
const PRICING_CARD_FEATURED = "border-brand/55 bg-bg-content";
const PRICING_CARD_DEFAULT = "border-border-subtle hover:border-border-strong";
const POPULAR_RAIL_CLASS = "absolute -top-px left-5 right-5 h-px bg-brand/70";
const POPULAR_BADGE_CLASS =
	"absolute -top-2.5 left-5 rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-contrast-fg";

const PLAN_COPY: Record<Exclude<PlanTier, "custom">, PlanCopy> = {
	free: {
		name: "Free",
		description: "Try Cohub with a small monthly balance.",
		features: ["Basic access", "Good for evaluation"],
	},
	plus: {
		name: "Plus",
		description: "For steady personal agent work.",
		features: ["Higher everyday limits", "Standard support"],
	},
	pro: {
		name: "Pro",
		description: "For active builders and small teams.",
		features: ["Advanced capabilities", "Priority support"],
	},
	max: {
		name: "Max",
		description: "For heavier self-serve workloads.",
		features: [
			"Highest self-serve limits",
			"Priority queue",
			"Dedicated support",
		],
	},
};

function getCheckoutButtonClass(
	emphasized: boolean,
	options: { muted?: boolean; alignBottom?: boolean } = {},
): string {
	const spacing = options.alignBottom ? "mt-auto" : "mt-5";
	const variant = emphasized
		? CHECKOUT_BUTTON_PRIMARY
		: options.muted
			? CHECKOUT_BUTTON_SECONDARY_MUTED
			: CHECKOUT_BUTTON_SECONDARY;
	return `${spacing} ${CHECKOUT_BUTTON_BASE} ${variant}`;
}

function getPricingCardClass(emphasized: boolean): string {
	return `${PRICING_CARD_BASE} ${emphasized ? PRICING_CARD_FEATURED : PRICING_CARD_DEFAULT}`;
}

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
			(sum, b) => sum + b.cycleAmountUsd,
			0,
		);
	}
	if (product.display.creditsAmount && product.display.creditsAmount > 0) {
		return product.display.creditsAmount * 0.00000001;
	}
	return product.pricing.amountUsd;
}

function getTotalPeriodBalance(product: BillingCatalogProduct): number {
	if (product.display.creditBenefits.length > 0) {
		return product.display.creditBenefits.reduce(
			(sum, b) => sum + b.periodAmountUsd,
			0,
		);
	}
	return getBalance(product);
}

function getMultiplier(product: BillingCatalogProduct): string | null {
	const totalBalance = getTotalPeriodBalance(product);
	const price = product.pricing.amountUsd;
	if (price <= 0 || totalBalance <= price * 1.005) return null;
	return `${(totalBalance / price).toFixed(2)}×`;
}

function getAnnualNote(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	const annual = product.pricing.amountUsd;
	const monthly = annual / 12;
	return `${formatUsd(annual)} billed yearly · ${formatUsd(monthly)}/mo`;
}

// Yearly savings, derived from catalog prices instead of catalog copy.
const yearlySavingsLabel = $derived.by(() => {
	for (const yearly of yearlyPlans) {
		const monthly = monthlyPlans.find(
			(plan) => getPlanTier(plan) === getPlanTier(yearly),
		);
		if (!monthly || monthly.pricing.amountUsd <= 0) continue;
		const annualized = monthly.pricing.amountUsd * 12;
		const saved = annualized - yearly.pricing.amountUsd;
		if (saved <= 0) continue;
		const percent = Math.round((saved / annualized) * 100);
		if (percent >= 1) return `Save ${percent}%`;
		return `Save ${formatUsd(saved)}`;
	}
	return null;
});

function getPlanTier(product: BillingCatalogProduct): PlanTier {
	const key = product.key.toLowerCase();
	const name = product.name.toLowerCase();
	const source = `${key} ${name}`;
	if (isFree(product) || source.includes("free")) return "free";
	if (source.includes("max")) return "max";
	if (source.includes("pro") || source.includes("standard")) return "pro";
	if (source.includes("plus")) return "plus";
	return "custom";
}

function getPlanCopy(product: BillingCatalogProduct): PlanCopy {
	const tier = getPlanTier(product);
	if (tier !== "custom") return PLAN_COPY[tier];
	return {
		name: product.name,
		description: "Flexible agent balance for your workspace.",
		features: ["Workspace access", "Usage-based balance"],
	};
}

function getPlanFeatureLabel(product: BillingCatalogProduct): string {
	return `${formatUsd(getBalance(product))} balance / mo`;
}

function getPackTitle(product: BillingCatalogProduct): string {
	return `${formatUsd(getBalance(product))} Balance Pack`;
}

function isRecommended(product: BillingCatalogProduct): boolean {
	return getPlanTier(product) === "pro";
}

function isFree(product: BillingCatalogProduct): boolean {
	return product.pricing.amountUsd === 0;
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
				? await sdk.billing.createSubscription(product.key, input)
				: await sdk.billing.createOrder(product.key, input);
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
	<header class="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
		<a href="/" class="flex items-center gap-2" aria-label="Cohub home">
			<div class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand text-[12px] font-semibold text-brand-contrast-fg">C</div>
			<span class="text-[13px] font-semibold tracking-tight">Cohub</span>
		</a>
		<a href="/" class="inline-flex items-center gap-1.5 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
			Open app
			<ChevronRight class="h-3.5 w-3.5" />
		</a>
	</header>

	<main class="mx-auto w-full max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pt-14">
		<div class="mb-10 max-w-3xl sm:mb-12">
			<p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-placeholder">Pricing</p>
			<h1 class="text-[clamp(34px,6vw,60px)] font-semibold leading-[0.98] tracking-[-0.055em] text-text-primary">
				Pay for the agent work you run.
			</h1>
		</div>

		{#if checkoutError}
			<div class="mb-6 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{checkoutError}</div>
		{/if}

		{#if catalogError}
			<div class="mb-6 rounded-[6px] border border-border-subtle bg-bg-subtle px-3 py-2 text-[12px] text-text-tertiary">{catalogError}</div>
		{/if}

		<section id="plans">
			<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-[15px] font-semibold tracking-tight">Plans</h2>
					<p class="mt-1 text-[12px] text-text-tertiary">Monthly balance for ongoing work.</p>
				</div>
				{#if !catalogLoading}
					<div class="inline-flex w-fit rounded-[7px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
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
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each [1, 2, 3, 4] as i (i)}
						<div class="h-72 animate-pulse rounded-[8px] bg-bg-hover-strong"></div>
					{/each}
				</div>
			{:else if visiblePlans.length === 0 && !catalogError}
				<div class="rounded-[6px] border border-border-subtle bg-bg-subtle px-4 py-5 text-[13px] text-text-tertiary">No plans available.</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each visiblePlans as product (product.key)}
						{@const recommended = isRecommended(product)}
						{@const free = isFree(product)}
						{@const multiplier = getMultiplier(product)}
						{@const annualNote = getAnnualNote(product)}
						{@const copy = getPlanCopy(product)}
						<div class={getPricingCardClass(recommended)}>
							{#if recommended}
								<div class={POPULAR_RAIL_CLASS}></div>
								<span class={POPULAR_BADGE_CLASS}>Most popular</span>
							{/if}

							<div class="space-y-2">
								<div class="flex items-start justify-between gap-3">
									<h3 class="text-[15px] font-semibold tracking-tight text-text-primary">{copy.name}</h3>
									{#if product.interval === "yearly"}
										<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">Yearly</span>
									{/if}
								</div>
								<p class="min-h-9 text-[12px] leading-[18px] text-text-tertiary">{copy.description}</p>
							</div>

							<div class="mt-5 border-t border-border-subtle/70 pt-5">
								<div class="flex items-baseline gap-1.5">
									{#if free}
										<span class="text-[34px] font-semibold tracking-[-0.045em] text-text-primary">Free</span>
									{:else}
										<span class="text-[34px] font-semibold tracking-[-0.045em] text-text-primary">{formatUsd(product.pricing.amountUsd)}</span>
										<span class="text-[12px] text-text-tertiary">/ {product.interval === "yearly" ? "yr" : "mo"}</span>
									{/if}
								</div>
								{#if annualNote}
									<p class="mt-1 text-[11px] text-text-placeholder">{annualNote}</p>
								{/if}
							</div>

							<ul class="mt-5 flex-1 space-y-2.5">
								<li class="flex items-start gap-2 text-[12px] leading-[18px] text-text-tertiary">
									<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
									<span>{getPlanFeatureLabel(product)}</span>
								</li>
								{#each copy.features as feature}
									<li class="flex items-start gap-2 text-[12px] leading-[18px] text-text-tertiary">
										<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
										<span>{feature}</span>
									</li>
								{/each}
							</ul>

							<button
								type="button"
								onclick={() => startCheckout(product)}
								disabled={checkoutBusyKey !== null}
								class={getCheckoutButtonClass(recommended, { muted: free })}
							>
								{#if checkoutBusyKey === product.key}
									<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
									Processing
								{:else if free}
									Get started
								{:else}
									Subscribe
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section id="packs" class="mt-16">
			<div class="mb-4">
				<h2 class="text-[15px] font-semibold tracking-tight">Balance Packs</h2>
			</div>

			{#if catalogLoading}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each [1, 2, 3, 4] as i (i)}
						<div class="h-48 animate-pulse rounded-[8px] bg-bg-hover-strong"></div>
					{/each}
				</div>
			{:else if packs.length === 0 && !catalogError}
				<div class="rounded-[6px] border border-border-subtle bg-bg-subtle px-4 py-5 text-[13px] text-text-tertiary">No balance packs available.</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each packs as product (product.key)}
						<div class="relative flex min-h-[198px] flex-col rounded-[10px] border border-border-subtle bg-bg-content px-5 py-5 transition-colors hover:border-border-strong">
							<h3 class="text-[15px] font-semibold tracking-tight text-text-primary">{getPackTitle(product)}</h3>

							<div class="mt-5 border-t border-border-subtle/70 pt-5">
								<div class="text-[34px] font-semibold tracking-[-0.045em] text-text-primary">{formatUsd(product.pricing.amountUsd)}</div>
								<p class="mt-1 text-[12px] text-text-placeholder">One-time purchase</p>
							</div>

							<button
								type="button"
								onclick={() => startCheckout(product)}
								disabled={checkoutBusyKey !== null}
								class={getCheckoutButtonClass(false, { alignBottom: true })}
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

	</main>
</div>
