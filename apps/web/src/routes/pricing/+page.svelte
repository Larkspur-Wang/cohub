<script lang="ts">
import type { BillingCatalogProduct } from "@neta-art/cohub";
import {
	ArrowRight,
	Check,
	ChevronRight,
	Loader2,
	ShieldCheck,
} from "lucide-svelte";
import { onMount } from "svelte";
import { page } from "$app/state";
import { signInWithRedirectPath } from "$lib/auth";
import { sdk } from "$lib/sdk";
import { authStore } from "$lib/stores/auth.svelte";

type Offer = {
	name: string;
	price: number;
	balance: number;
	period?: string;
	description: string;
	highlight?: string;
	benefits: string[];
	kind: "plan" | "pack";
	productKey?: string;
};

let catalogPlanOffers = $state<Offer[]>([]);
let catalogPackOffers = $state<Offer[]>([]);
let catalogLoading = $state(true);
let catalogError = $state("");
let checkoutBusyKey = $state<string | null>(null);
let checkoutError = $state("");

const pricingReturnPath = $derived(`${page.url.pathname}${page.url.search}`);
const visiblePlanOffers = $derived(catalogPlanOffers);
const visiblePackOffers = $derived(catalogPackOffers);

function formatUsd(value: number): string {
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
		maximumFractionDigits: 2,
	})}`;
}

function getProductBalance(product: BillingCatalogProduct): number | null {
	if (product.display.creditBenefits.length > 0) {
		return product.display.creditBenefits.reduce(
			(sum, benefit) => sum + benefit.periodAmountUsd,
			0,
		);
	}
	if (
		typeof product.display.creditsAmount === "number" &&
		product.display.creditsAmount > 0
	) {
		return product.display.creditsAmount * 0.00000001;
	}
	return null;
}

function getProductPeriod(product: BillingCatalogProduct): string | undefined {
	if (product.kind !== "plan") return undefined;
	if (product.interval === "monthly") return "month";
	if (product.interval === "quarterly") return "quarter";
	if (product.interval === "yearly") return "year";
	return product.billingPeriod || undefined;
}

function formatValidityDays(days: number): string {
	if (days % 365 === 0)
		return `Valid for ${days / 365} year${days === 365 ? "" : "s"}`;
	if (days % 30 === 0)
		return `Valid for ${days / 30} month${days === 30 ? "" : "s"}`;
	return `Valid for ${days} day${days === 1 ? "" : "s"}`;
}

function getBalanceValidity(product: BillingCatalogProduct): string {
	if (product.kind === "plan") return "Resets each billing cycle";
	const expirations = [
		...new Set(
			product.display.creditBenefits.map(
				(benefit) => benefit.expiresInDays ?? null,
			),
		),
	];
	if (expirations.length === 1) {
		const [expiresInDays] = expirations;
		return expiresInDays === null
			? "No expiration"
			: formatValidityDays(expiresInDays);
	}
	return "Validity varies by balance source";
}

function mapCatalogOffer(product: BillingCatalogProduct): Offer {
	const balance = getProductBalance(product) ?? product.pricing.amountUsd;
	return {
		name: product.name,
		price: product.pricing.amountUsd,
		balance,
		period: getProductPeriod(product),
		description:
			product.display.description ??
			product.description ??
			"Usage balance for Cohub work.",
		highlight: product.isDefaultPlan ? "Default" : undefined,
		benefits:
			product.display.benefits.length > 0
				? product.display.benefits
				: [
						`${formatUsd(balance)} usage balance${product.kind === "plan" ? " / cycle" : ""}`,
						getBalanceValidity(product),
					],
		kind: product.kind === "plan" ? "plan" : "pack",
		productKey: product.key,
	};
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
		catalogPlanOffers = catalog.plans.map(mapCatalogOffer);
		catalogPackOffers = catalog.addons.map(mapCatalogOffer);
	} catch (error) {
		catalogError = "Failed to load pricing.";
		console.warn("[pricing] Failed to load billing catalog", error);
	} finally {
		catalogLoading = false;
	}
}

async function startCheckout(offer: Offer) {
	if (!offer.productKey) {
		await signInWithRedirectPath(
			`/settings/billing?tab=${offer.kind === "plan" ? "plans" : "addons"}`,
		);
		return;
	}
	await authStore.ensureLoaded();
	if (!authStore.isAuthenticated) {
		await signInWithRedirectPath(pricingReturnPath);
		return;
	}
	checkoutBusyKey = offer.productKey;
	checkoutError = "";
	try {
		const input = { returnUrl: `${window.location.origin}/settings/billing` };
		const { checkout } =
			offer.kind === "plan"
				? await sdk.billing.subscribePlan(offer.productKey, input)
				: await sdk.billing.purchaseAddon(offer.productKey, input);
		if (checkout.checkoutUsable && checkout.checkoutUrl) {
			window.location.href = checkout.checkoutUrl;
			return;
		}
		checkoutError =
			checkout.payment.reason ??
			checkout.message ??
			"Checkout is not available";
	} catch (error) {
		console.warn("[pricing] Failed to start checkout", error);
		checkoutError = "Checkout is not available right now.";
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
	<meta name="description" content="Cohub pricing for usage balance, plans, and balance packs." />
</svelte:head>

<div class="min-h-screen overflow-y-auto bg-bg-primary text-text-primary">
	<header class="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-7">
		<a href="/" class="flex items-center gap-2" aria-label="Cohub home">
			<div class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand text-[12px] font-semibold text-brand-contrast-fg">C</div>
			<span class="text-[13px] font-semibold tracking-tight">Cohub</span>
		</a>
		<nav class="flex items-center gap-3 text-[12px] text-text-tertiary">
			<a href="/explore?view=wall" class="hidden transition-colors hover:text-text-secondary sm:inline">Explore</a>
			<a href="/settings/billing" class="transition-colors hover:text-text-secondary">Billing</a>
			<a href="/" class="inline-flex items-center gap-1 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
				Open app
				<ChevronRight class="h-3.5 w-3.5" />
			</a>
		</nav>
	</header>

	<main class="mx-auto w-full max-w-6xl px-5 pb-16 pt-8 sm:px-7 sm:pt-14">
		<section class="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
			<div>
				<div class="mb-5 inline-flex items-center gap-2 rounded-full border border-border-subtle bg-bg-subtle px-3 py-1 text-[11px] text-text-tertiary">
					<span class="h-1.5 w-1.5 rounded-full bg-brand"></span>
					Usage balance, not tokens
				</div>
				<h1 class="max-w-3xl text-[clamp(34px,7vw,72px)] font-semibold leading-[0.95] tracking-[-0.055em] text-text-primary">
					Simple pricing for serious agent work.
				</h1>
				<p class="mt-5 max-w-xl text-[15px] leading-7 text-text-secondary">
					Plans include monthly usage balance. Packs top up your account anytime. Every dollar is easy to trace in usage history.
				</p>
				<div class="mt-7 flex flex-col gap-3 sm:flex-row">
					<a href="#plans" class="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] bg-brand px-4 text-[13px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover">
						View plans
						<ArrowRight class="h-3.5 w-3.5" />
					</a>
					<a href="#rules" class="inline-flex h-9 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-input px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
						Balance rules
					</a>
				</div>
			</div>

			<div class="border-l border-border-subtle pl-5 lg:pl-8">
				<div class="text-[11px] uppercase tracking-[0.18em] text-text-tertiary">How balance works</div>
				<div class="mt-4 grid gap-3 text-[13px] text-text-secondary">
					<div class="flex gap-3"><Check class="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>Monthly balance resets each billing cycle and does not roll over.</span></div>
					<div class="flex gap-3"><Check class="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>Purchased balance validity is defined by each pack.</span></div>
					<div class="flex gap-3"><Check class="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span>Balance that expires sooner is used first.</span></div>
				</div>
			</div>
		</section>

		{#if checkoutError}
			<div class="mt-5 rounded-[6px] border border-error-soft/30 bg-error-bg px-3 py-2 text-[12px] text-error-soft">{checkoutError}</div>
		{/if}

		{#if catalogError}
			<div class="mt-5 rounded-[6px] border border-border-subtle bg-bg-subtle px-3 py-2 text-[12px] text-text-tertiary">{catalogError}</div>
		{/if}

		<section id="plans" class="mt-16 scroll-mt-8">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-[18px] font-semibold tracking-tight">Plans</h2>
					<p class="mt-1 text-[13px] text-text-tertiary">Subscribe for a small monthly balance bonus and higher limits.</p>
				</div>
				<div class="text-[12px] text-text-tertiary">{catalogLoading ? "Loading live prices" : "Monthly included balance resets each cycle."}</div>
			</div>
			{#if !catalogLoading && visiblePlanOffers.length === 0}
				<div class="mt-5 rounded-[6px] border border-border-subtle bg-bg-subtle px-3 py-4 text-[12px] text-text-tertiary">No plans are available.</div>
			{:else}
				<div class="mt-5 grid gap-3 lg:grid-cols-3">
					{#each visiblePlanOffers as offer (offer.productKey ?? offer.name)}
						{@render offerCard(offer)}
					{/each}
				</div>
			{/if}
		</section>

		<section id="packs" class="mt-14 scroll-mt-8">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 class="text-[18px] font-semibold tracking-tight">Balance Packs</h2>
					<p class="mt-1 text-[13px] text-text-tertiary">Top up without changing your plan.</p>
				</div>
				<div class="text-[12px] text-text-tertiary">{catalogLoading ? "Loading live packs" : "Validity is shown on each pack."}</div>
			</div>
			{#if !catalogLoading && visiblePackOffers.length === 0}
				<div class="mt-5 rounded-[6px] border border-border-subtle bg-bg-subtle px-3 py-4 text-[12px] text-text-tertiary">No balance packs are available.</div>
			{:else}
				<div class="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
					{#each visiblePackOffers as offer (offer.productKey ?? offer.name)}
						{@render offerCard(offer)}
					{/each}
				</div>
			{/if}
		</section>

		<section id="rules" class="mt-16 grid gap-5 border-t border-border-subtle pt-8 lg:grid-cols-[0.8fr_1.2fr]">
			<div>
				<div class="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-subtle text-brand">
					<ShieldCheck class="h-4 w-4" />
				</div>
				<h2 class="mt-4 text-[18px] font-semibold tracking-tight">Clear balance rules</h2>
			</div>
			<div class="grid gap-3 text-[13px] text-text-secondary sm:grid-cols-2">
				<p class="leading-6">Usage balance is applied to Cohub services. It is not cash and cannot be withdrawn.</p>
				<p class="leading-6">Bonus balance may expire sooner. Balance with the nearest expiration is used first.</p>
				<p class="leading-6">Pending usage is settled from future balance. Overage limits will be introduced with preflight checks later.</p>
				<p class="leading-6">Pricing stays intentionally simple: plans for recurring work, packs for occasional top-ups.</p>
			</div>
		</section>
	</main>
</div>

{#snippet offerCard(offer: Offer)}
	<div class="group flex min-h-72 flex-col rounded-[7px] border border-border-subtle bg-bg-content px-4 py-4 transition-colors hover:border-border-strong">
		<div class="flex min-w-0 items-start justify-between gap-3">
			<div class="min-w-0">
				<h3 class="truncate text-[14px] font-semibold text-text-primary">{offer.name}</h3>
				<p class="mt-1 text-[12px] leading-5 text-text-tertiary">{offer.description}</p>
			</div>
			{#if offer.highlight}
				<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">{offer.highlight}</span>
			{/if}
		</div>
		<div class="mt-5">
			<div class="text-[24px] font-semibold tracking-tight text-text-primary">
				{formatUsd(offer.price)}{#if offer.period}<span class="text-[12px] font-normal text-text-tertiary"> / {offer.period}</span>{/if}
			</div>
			<div class="mt-1 text-[12px] text-text-secondary">
				Get {formatUsd(offer.balance)} usage balance{#if offer.period} / {offer.period}{/if}
			</div>
		</div>
		<ul class="mt-5 grid gap-2 text-[12px] text-text-tertiary">
			{#each offer.benefits as benefit}
				<li class="flex gap-2"><Check class="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" /><span>{benefit}</span></li>
			{/each}
		</ul>
		<button type="button" onclick={() => startCheckout(offer)} disabled={checkoutBusyKey !== null} class="mt-auto inline-flex h-8 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
			{#if checkoutBusyKey === offer.productKey}
				<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
				Processing
			{:else if offer.productKey}
				{offer.kind === "plan" ? "Subscribe" : "Purchase"}
			{:else}
				Open billing
			{/if}
		</button>
	</div>
{/snippet}
