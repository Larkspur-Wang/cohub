<script lang="ts">
import type { BillingCatalogProduct } from "@neta-art/cohub";
import { Check } from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { signInWithRedirectPath } from "$lib/auth";
import BillingCheckoutSheet from "$lib/components/BillingCheckoutSheet.svelte";
import PublicHeader from "$lib/components/PublicHeader.svelte";
import {
	type PublicLocale,
	resolvePublicLocale,
} from "$lib/i18n/public-locale";
import { m } from "$lib/paraglide/messages.js";
import { canonicalUrl } from "$lib/seo";
import { authStore } from "$lib/stores/auth.svelte";
import { billingCatalogStore } from "$lib/stores/billing-catalog.svelte";

const locale = $derived<PublicLocale>(resolvePublicLocale(page.url.pathname));
const zh = $derived(locale === "zh-CN");
const canonicalPath = $derived(zh ? "/zh/pricing" : "/pricing");
const pricingTitle = $derived(m.pricing_seo_title({}, { locale }));
const pricingDescription = $derived(m.pricing_seo_description({}, { locale }));
const canonical = $derived(canonicalUrl(page.url.origin, canonicalPath));

type PlanInterval = "monthly" | "yearly";

let freePlan = $state<BillingCatalogProduct | null>(null);
let monthlyPlans = $state<BillingCatalogProduct[]>([]);
let yearlyPlans = $state<BillingCatalogProduct[]>([]);
let catalogLoading = $state(true);
let catalogError = $state("");
let checkoutProduct = $state<BillingCatalogProduct | null>(null);
let checkoutLoadingKey = $state<string | null>(null);
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
	"relative flex min-h-[296px] flex-col rounded-[10px] border bg-bg-content px-5 py-5 transition-colors";
const PRICING_CARD_FEATURED = "border-brand/55 bg-bg-content";
const PRICING_CARD_DEFAULT = "border-border-subtle hover:border-border-strong";
const POPULAR_RAIL_CLASS = "absolute -top-px left-5 right-5 h-px bg-brand/70";
const POPULAR_BADGE_CLASS =
	"absolute -top-2.5 left-5 rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-contrast-fg";

function getCheckoutButtonClass(
	emphasized: boolean,
	options: { muted?: boolean; alignBottom?: boolean } = {},
): string {
	const spacing = options.alignBottom ? "mt-auto" : "mt-7";
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
function getAnnualNote(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	const annual = product.pricing.amountUsd;
	const monthly = annual / 12;
	return m.pricing_billed_yearly(
		{ amount: formatUsd(annual), monthly: formatUsd(monthly) },
		{ locale },
	);
}

function getYearlySavings(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	if (
		typeof product.pricing.discountRate === "number" &&
		product.pricing.discountRate > 0
	) {
		return m.pricing_save_pct(
			{ percent: Math.round(product.pricing.discountRate * 100) },
			{ locale },
		);
	}
	const compareAt = product.pricing.compareAtAmountUsd;
	if (typeof compareAt === "number" && compareAt > product.pricing.amountUsd) {
		const percent = Math.round(
			((compareAt - product.pricing.amountUsd) / compareAt) * 100,
		);
		return percent > 0 ? m.pricing_save_pct({ percent }, { locale }) : null;
	}
	const monthly = monthlyPlans.find(
		(plan) => getPlanTier(plan) === getPlanTier(product),
	);
	if (!monthly || monthly.pricing.amountUsd <= 0) return null;
	const annualized = monthly.pricing.amountUsd * 12;
	const saved = annualized - product.pricing.amountUsd;
	if (saved <= 0) return null;
	const percent = Math.round((saved / annualized) * 100);
	return percent > 0 ? m.pricing_save_pct({ percent }, { locale }) : null;
}

const yearlySavingsLabel = $derived.by(() => {
	for (const plan of yearlyPlans) {
		const savings = getYearlySavings(plan);
		if (savings) return savings;
	}
	return null;
});

function getPlanTier(product: BillingCatalogProduct): string {
	const source = `${product.key} ${product.name}`.toLowerCase();
	if (isFree(product) || source.includes("free")) return "free";
	if (source.includes("max")) return "max";
	if (source.includes("pro") || source.includes("standard")) return "pro";
	if (source.includes("plus")) return "plus";
	return product.key;
}

function isRecommended(product: BillingCatalogProduct): boolean {
	return getPlanTier(product) === "pro";
}

function isFree(product: BillingCatalogProduct): boolean {
	return product.pricing.amountUsd === 0;
}

async function loadCatalog() {
	catalogLoading = !billingCatalogStore.catalog;
	try {
		catalogError = "";
		const catalog = await billingCatalogStore.load();
		if (!catalog.billing.configured) {
			catalogError = m.pricing_not_available({}, { locale });
			return;
		}
		const publicPlans = catalog.plans.filter(
			(product) => product.visibility === "public",
		);
		freePlan = publicPlans.find((p) => isFree(p)) ?? null;
		const freeKey = freePlan?.key;
		monthlyPlans = sortByPrice(
			publicPlans.filter((p) => p.interval === "monthly" && p.key !== freeKey),
		);
		yearlyPlans = sortByPrice(
			publicPlans.filter((p) => p.interval === "yearly" && p.key !== freeKey),
		);
	} catch (error) {
		catalogError = m.pricing_load_failed({}, { locale });
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
			product.kind === "plan"
				? "/settings/billing?tab=plans"
				: "/settings/billing",
		);
		return;
	}
	await authStore.ensureLoaded();
	if (!authStore.isAuthenticated) {
		await signInWithRedirectPath(pricingReturnPath);
		return;
	}
	checkoutError = "";
	checkoutLoadingKey = product.key;
	try {
		const personalizedCatalog = await billingCatalogStore.load();
		checkoutProduct =
			personalizedCatalog.products.find((item) => item.key === product.key) ??
			product;
	} catch (error) {
		checkoutError = m.pricing_checkout_unavailable({}, { locale });
		console.warn("[pricing] Failed to refresh personalized pricing", error);
	} finally {
		checkoutLoadingKey = null;
	}
}

onMount(() => {
	void loadCatalog();
});
</script>

<svelte:head>
	<title>{pricingTitle}</title>
	<meta name="description" content={pricingDescription} />
	<link rel="canonical" href={canonical} />
	<link rel="alternate" hreflang="en" href={canonicalUrl(page.url.origin, "/pricing")} />
	<link rel="alternate" hreflang="zh-CN" href={canonicalUrl(page.url.origin, "/zh/pricing")} />
	<link rel="alternate" hreflang="x-default" href={canonicalUrl(page.url.origin, "/pricing")} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Cohub" />
	<meta property="og:title" content={pricingTitle} />
	<meta property="og:description" content={pricingDescription} />
	<meta property="og:url" content={canonical} />
	<meta property="og:locale" content={zh ? "zh_CN" : "en_US"} />
	<meta property="og:locale:alternate" content={zh ? "en_US" : "zh_CN"} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pricingTitle} />
	<meta name="twitter:description" content={pricingDescription} />
</svelte:head>

<div class="min-h-screen bg-bg-primary text-text-primary">
	<PublicHeader cta="open-app" />

	<main class="mx-auto w-full max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pt-14">
		<div class="mb-10 max-w-3xl sm:mb-12">
			<h1 class="text-[clamp(34px,6vw,60px)] font-semibold leading-[0.98] tracking-[-0.055em] text-text-primary">
				{m.pricing_headline({}, { locale })}
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
					<h2 class="text-[15px] font-semibold tracking-tight">{m.pricing_plans({}, { locale })}</h2>
				</div>
				{#if !catalogLoading}
					<div class="inline-flex w-fit rounded-[7px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
						<button
							type="button"
							onclick={() => (interval = "monthly")}
							class="rounded-[5px] px-3 py-1.5 transition-colors {interval === 'monthly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}"
						>{m.pricing_monthly({}, { locale })}</button>
						<button
							type="button"
							onclick={() => (interval = "yearly")}
							disabled={!hasYearly}
							class="relative rounded-[5px] px-3 py-1.5 transition-colors {interval === 'yearly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-40"
						>
							{m.pricing_yearly({}, { locale })}
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
				<div class="rounded-[6px] border border-border-subtle bg-bg-subtle px-4 py-5 text-[13px] text-text-tertiary">{m.pricing_no_plans({}, { locale })}</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{#each visiblePlans as product (product.key)}
						{@const recommended = isRecommended(product)}
						{@const free = isFree(product)}
						{@const annualNote = getAnnualNote(product)}
						{@const yearlySavings = getYearlySavings(product)}
						<div class={getPricingCardClass(recommended)}>
							{#if recommended}
								<div class={POPULAR_RAIL_CLASS}></div>
								<span class={POPULAR_BADGE_CLASS}>{m.pricing_most_popular({}, { locale })}</span>
							{/if}

							<div class="space-y-2">
								<div class="flex items-start justify-between gap-3">
									<h3 class="text-[15px] font-semibold tracking-tight text-text-primary">{product.name}</h3>
									{#if yearlySavings}
										<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">{yearlySavings}</span>
									{/if}
								</div>
							</div>

							<div class="mt-5 border-t border-border-subtle/70 pt-5">
								<div class="flex items-baseline gap-1.5">
									{#if free}
										<span class="text-[34px] font-semibold tracking-[-0.045em] text-text-primary">{m.pricing_free({}, { locale })}</span>
									{:else}
										<span class="text-[34px] font-semibold tracking-[-0.045em] text-text-primary">{formatUsd(product.pricing.amountUsd)}</span>
										<span class="text-[12px] text-text-tertiary">/ {product.interval === "yearly" ? m.pricing_per_yr({}, { locale }) : m.pricing_per_mo({}, { locale })}</span>
									{/if}
								</div>
								{#if annualNote}
									<p class="mt-1 text-[11px] text-text-placeholder">{annualNote}</p>
								{/if}
							</div>

							<ul class="mt-5 flex-1 space-y-2.5">
								<li class="flex items-start gap-2 text-[12px] leading-[18px] text-text-tertiary">
									<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
									<span>{m.pricing_balance_per_mo({ amount: formatUsd(getBalance(product)) }, { locale })}</span>
								</li>
								{#each product.display.benefits.slice(0, 3) as benefit}
									<li class="flex items-start gap-2 text-[12px] leading-[18px] text-text-tertiary">
										<Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
										<span>{benefit}</span>
									</li>
								{/each}
							</ul>

							<button
								type="button"
								onclick={() => startCheckout(product)}
								disabled={checkoutLoadingKey !== null}
								class={getCheckoutButtonClass(recommended, { muted: free })}
							>
								{#if checkoutLoadingKey === product.key}
									{m.pricing_preparing({}, { locale })}
								{:else if free}
									{m.pricing_get_started({}, { locale })}
								{:else}
									{m.pricing_subscribe({}, { locale })}
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

	</main>
</div>

<BillingCheckoutSheet
	open={checkoutProduct !== null}
	product={checkoutProduct}
	returnUrl={typeof window === "undefined" ? undefined : `${window.location.origin}/settings/billing`}
	onClose={() => (checkoutProduct = null)}
/>
