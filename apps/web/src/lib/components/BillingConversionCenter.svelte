<script lang="ts">
import type {
	BillingCatalog,
	BillingCatalogProduct,
	BillingCreditStatus,
} from "@neta-art/cohub";
import { AlertCircle, Check, CreditCard, Loader2, X } from "lucide-svelte";
import BillingCheckoutSheet from "$lib/components/BillingCheckoutSheet.svelte";
import Sheet from "$lib/components/Sheet.svelte";
import { formatCurrency } from "$lib/i18n/format";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import { sdk } from "$lib/sdk";
import { billingCatalogStore } from "$lib/stores/billing-catalog.svelte";

const locale = $derived(getLocale());

import { billingConversion } from "$lib/stores/billing-conversion.svelte";

type PlanInterval = "monthly" | "yearly";

let catalog = $state<BillingCatalog | null>(null);
let catalogRefreshing = $state(false);
let error = $state("");
let checkoutProduct = $state<BillingCatalogProduct | null>(null);
let checkoutError = $state("");
let credit = $state<BillingCreditStatus | null>(null);
let creditLoading = $state(false);
let creditError = $state("");
let wasOpen = false;
let selectedPlanInterval = $state<PlanInterval>("monthly");

const open = $derived(billingConversion.open);
const intent = $derived(billingConversion.intent);
const warning = $derived(billingConversion.warning);
const isHard = $derived(intent?.level === "hard");
const currentSubscription = $derived(
	catalog?.currentSubscriptions.find(
		(subscription) =>
			subscription.status === "active" || subscription.status === "trialing",
	) ?? null,
);
const hasActivePaidPlan = $derived.by(() => {
	if (!catalog?.hasActiveSubscription) return false;
	const defaultKey = catalog.defaultPlanProductKey;
	return catalog.currentSubscriptions.some(
		(subscription) =>
			(subscription.status === "active" ||
				subscription.status === "trialing") &&
			!!subscription.productKey &&
			subscription.productKey !== defaultKey,
	);
});
const defaultPlan = $derived.by(() =>
	catalog?.defaultPlanProductKey
		? (catalog.plans.find(
				(product) => product.key === catalog?.defaultPlanProductKey,
			) ?? null)
		: null,
);
const paidPlans = $derived.by(() =>
	sortProducts(
		(catalog?.plans ?? []).filter(
			(product) => product.key !== defaultPlan?.key,
		),
	),
);
const creditPackages = $derived.by(() => sortProducts(catalog?.addons ?? []));
const monthlyPlans = $derived.by(() =>
	paidPlans.filter((product) => product.interval === "monthly"),
);
const yearlyPlans = $derived.by(() =>
	paidPlans.filter((product) => product.interval === "yearly"),
);
const hasYearlyPlans = $derived(yearlyPlans.length > 0);
const activePlanInterval = $derived(
	selectedPlanInterval === "yearly" && hasYearlyPlans ? "yearly" : "monthly",
);
const visiblePlanProducts = $derived.by(() => {
	if (activePlanInterval === "yearly") return yearlyPlans;
	if (monthlyPlans.length === 0 && hasYearlyPlans) return yearlyPlans;
	return monthlyPlans;
});
const primaryProducts = $derived.by(() => {
	if (!catalog) return [];
	if (hasActivePaidPlan && creditPackages.length > 0) {
		return creditPackages.slice(0, 4);
	}
	return visiblePlanProducts;
});
const headline = $derived(
	intent?.title ??
		(isHard
			? m.billing_conv_add_credits({}, { locale })
			: m.billing_conv_balance_below_zero({}, { locale })),
);
const balanceLabel = $derived(
	warning
		? formatUsd(warning.netUsd)
		: credit
			? formatUsd(credit.netUsd)
			: null,
);
const primaryLabel = $derived(
	hasActivePaidPlan && creditPackages.length > 0
		? m.billing_credit_packages({}, { locale })
		: m.billing_choose_plan({}, { locale }),
);
const selectedIntervalLabel = $derived(
	visiblePlanProducts === yearlyPlans
		? m.billing_yearly({}, { locale })
		: m.billing_monthly({}, { locale }),
);

$effect(() => {
	if (open && !wasOpen) {
		wasOpen = true;
		void loadBillingData();
	} else if (!open) {
		wasOpen = false;
	}
});

function sortProducts(products: BillingCatalogProduct[]) {
	return [...products].sort(
		(a, b) => a.pricing.amountUsd - b.pricing.amountUsd,
	);
}

function formatUsd(value: number | null | undefined) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return formatCurrency(0, "USD", { locale });
	}
	return formatCurrency(value, "USD", {
		locale,
		minimumFractionDigits: 2,
		maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
	});
}

function productPrice(product: BillingCatalogProduct) {
	const price = formatUsd(product.pricing.amountUsd);
	if (product.kind === "addon") return price;
	if (product.interval === "monthly")
		return `${price}${m.billing_conv_per_month({}, { locale })}`;
	if (product.interval === "yearly")
		return `${price}${m.billing_conv_per_year({}, { locale })}`;
	return price;
}

function discountText(product: BillingCatalogProduct): string | null {
	const label = product.pricing.discountLabel?.trim();
	if (label && !["none", "no discount", "null"].includes(label.toLowerCase())) {
		return label;
	}
	if (
		typeof product.pricing.discountRate === "number" &&
		product.pricing.discountRate > 0
	) {
		return m.billing_discount_rate(
			{ rate: Math.round(product.pricing.discountRate * 100) },
			{ locale },
		);
	}
	return null;
}

function getYearlySavings(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	if (
		typeof product.pricing.discountRate === "number" &&
		product.pricing.discountRate > 0
	) {
		return m.billing_conv_save_pct(
			{ percent: Math.round(product.pricing.discountRate * 100) },
			{ locale },
		);
	}
	const compareAt = product.pricing.compareAtAmountUsd;
	if (typeof compareAt === "number" && compareAt > product.pricing.amountUsd) {
		const percent = Math.round(
			((compareAt - product.pricing.amountUsd) / compareAt) * 100,
		);
		return percent > 0
			? m.billing_conv_save_pct({ percent }, { locale })
			: null;
	}
	const monthly = monthlyPlans.find(
		(plan) => getPlanTier(plan) === getPlanTier(product),
	);
	if (!monthly || monthly.pricing.amountUsd <= 0) return null;
	const annualized = monthly.pricing.amountUsd * 12;
	const saved = annualized - product.pricing.amountUsd;
	if (saved <= 0) return null;
	const percent = Math.round((saved / annualized) * 100);
	return percent > 0 ? m.billing_conv_save_pct({ percent }, { locale }) : null;
}

const yearlySavingsLabel = $derived.by(() => {
	for (const plan of yearlyPlans) {
		const savings = getYearlySavings(plan);
		if (savings) return savings;
	}
	return null;
});

function includedBalanceText(product: BillingCatalogProduct): string {
	if (product.display.creditBenefits.length > 0) {
		return product.display.creditBenefits
			.map((benefit) => formatUsd(benefit.periodAmountUsd))
			.join(", ");
	}
	if (
		typeof product.display.creditsAmount === "number" &&
		Number.isFinite(product.display.creditsAmount) &&
		product.display.creditsAmount > 0
	) {
		return formatUsd(product.display.creditsAmount * 0.00000001);
	}
	return "";
}

function productSubtitle(product: BillingCatalogProduct) {
	if (product.display.description) return product.display.description;
	const credits = includedBalanceText(product);
	if (credits)
		return m.billing_conv_included_credits({ amount: credits }, { locale });
	return product.kind === "addon"
		? m.billing_conv_one_time_pack({}, { locale })
		: m.billing_conv_workspace_plan({}, { locale });
}

function getPlanTier(product: BillingCatalogProduct): string {
	const source = `${product.key} ${product.name}`.toLowerCase();
	if (source.includes("free")) return "free";
	if (source.includes("max")) return "max";
	if (source.includes("pro") || source.includes("standard")) return "pro";
	if (source.includes("plus")) return "plus";
	return product.key;
}

function isRecommended(product: BillingCatalogProduct): boolean {
	return getPlanTier(product) === "pro";
}

function isCurrentPlanProduct(product: BillingCatalogProduct): boolean {
	return currentSubscription?.productKey === product.key;
}

function annualNote(product: BillingCatalogProduct): string | null {
	if (product.interval !== "yearly") return null;
	return m.billing_conv_billed_yearly(
		{ amount: formatUsd(product.pricing.amountUsd) },
		{ locale },
	);
}

function returnUrl() {
	return typeof window === "undefined" ? undefined : window.location.href;
}

async function loadBillingData(options: { force?: boolean } = {}) {
	await Promise.all([loadCatalog(options), loadCreditStatus(options)]);
}

async function loadCreditStatus(options: { force?: boolean } = {}) {
	if (creditLoading && !options.force) return;
	creditLoading = true;
	creditError = "";
	try {
		credit = await sdk.billing.getCredits();
	} catch (loadError) {
		creditError =
			loadError instanceof Error ? loadError.message : "Failed to load balance";
	} finally {
		creditLoading = false;
	}
}

async function loadCatalog(options: { force?: boolean } = {}) {
	catalog = billingCatalogStore.catalog;
	catalogRefreshing = true;
	error = "";
	try {
		catalog = await billingCatalogStore.load({
			force: options.force,
			silent: !!catalog,
		});
	} catch (loadError) {
		error =
			loadError instanceof Error
				? loadError.message
				: "Failed to load billing options";
	} finally {
		catalogRefreshing = false;
	}
}

function startCheckout(product: BillingCatalogProduct) {
	if (catalog?.payment.available === false || isCurrentPlanProduct(product)) {
		return;
	}
	checkoutError = "";
	checkoutProduct = product;
	billingConversion.close();
}
</script>

{#if open && intent}
	<Sheet open onClose={() => billingConversion.close()} maxWidth="760px">
		<div class="flex max-h-[88vh] flex-col">
			<header class="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-3.5">
				<div class="min-w-0">
					<h2 class="truncate text-[16px] font-semibold leading-6 text-text-primary">{headline}</h2>
				</div>
				<button type="button" class="shrink-0 cursor-pointer rounded-[6px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/40" onclick={() => billingConversion.close()} aria-label={m.common_close({}, { locale })}>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-safe">
				<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div class="text-[11px] text-text-tertiary">{m.billing_conv_current_balance({}, { locale })}</div>
						<div class="mt-1 font-mono text-[14px] text-text-primary">{creditLoading && !balanceLabel ? m.billing_loading({}, { locale }) : (balanceLabel ?? "—")}</div>
						{#if creditError && !balanceLabel}
							<div class="mt-1 text-[11px] text-error">{creditError}</div>
						{/if}
					</div>
					{#if catalog && !hasActivePaidPlan && (monthlyPlans.length > 0 || yearlyPlans.length > 0)}
						<div class="inline-flex rounded-[7px] border border-border-subtle bg-bg-hover p-0.5 text-[12px]">
							<button type="button" onclick={() => (selectedPlanInterval = "monthly")} class="min-h-10 cursor-pointer rounded-[5px] px-3 py-1.5 transition-colors hover:text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand/40 sm:min-h-8 {selectedPlanInterval === 'monthly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary'}">
								{m.billing_monthly({}, { locale })}
							</button>
							<button type="button" onclick={() => (selectedPlanInterval = "yearly")} disabled={!hasYearlyPlans} class="min-h-10 cursor-pointer rounded-[5px] px-3 py-1.5 transition-colors hover:text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand/40 sm:min-h-8 {selectedPlanInterval === 'yearly' && hasYearlyPlans ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary'} disabled:cursor-not-allowed disabled:opacity-40">
								{m.billing_yearly({}, { locale })}
								{#if hasYearlyPlans && yearlySavingsLabel}
									<span class="ml-1.5 rounded-[4px] bg-brand/15 px-1 py-0.5 text-[10px] font-medium text-brand">{yearlySavingsLabel}</span>
								{/if}
							</button>
						</div>
					{/if}
				</div>

				{#if catalogRefreshing && !catalog}
					<div class="flex items-center gap-2 py-8 text-[13px] text-text-secondary"><Loader2 class="h-4 w-4 animate-spin" /> {m.billing_conv_loading_options({}, { locale })}</div>
				{:else if error}
					<div class="rounded-[8px] border border-border-subtle bg-bg-content p-4">
						<div class="flex items-center gap-2 text-[13px] text-text-primary"><AlertCircle class="h-4 w-4 text-error" /> {error}</div>
						<button type="button" class="mt-3 cursor-pointer rounded-[6px] border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => loadCatalog({ force: true })}>{m.common_retry({}, { locale })}</button>
					</div>
				{:else if catalog}
					{#if !hasActivePaidPlan && (monthlyPlans.length > 0 || yearlyPlans.length > 0)}
						<section>
							<div class="mb-2 flex items-center justify-between gap-3">
								<div class="text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">{m.billing_conv_plans_interval({ label: selectedIntervalLabel }, { locale })}</div>
								{#if activePlanInterval === "yearly" && hasYearlyPlans}
									<div class="text-[11px] text-brand">{m.billing_conv_best_value({}, { locale })}</div>
								{/if}
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								{#each visiblePlanProducts as product (product.key)}
									{@const recommended = isRecommended(product)}
									{@const current = isCurrentPlanProduct(product)}
									{@const note = annualNote(product)}
									<div class="relative flex min-h-[218px] flex-col rounded-[10px] border bg-bg-content px-4 py-4 transition-colors {recommended ? 'border-brand/55' : 'border-border-subtle hover:border-border-primary'}">
										{#if recommended}
											<div class="absolute -top-px left-4 right-4 h-px bg-brand/70"></div>
											<span class="absolute -top-2.5 left-4 rounded-[4px] bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-contrast-fg">{m.billing_conv_popular({}, { locale })}</span>
										{/if}

										<div class="flex items-start justify-between gap-3">
											<div class="min-w-0">
												<h3 class="truncate text-[14px] font-semibold tracking-tight text-text-primary">{product.name}</h3>
												<p class="mt-1 line-clamp-2 text-[12px] leading-4 text-text-tertiary">{productSubtitle(product)}</p>
											</div>
											{#if current}
												<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">{m.billing_conv_current({}, { locale })}</span>
											{:else if discountText(product)}
												<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium text-brand">{discountText(product)}</span>
											{/if}
										</div>

										<div class="mt-4 border-t border-border-subtle/70 pt-4">
											<div class="flex items-baseline gap-1.5">
												<span class="text-[28px] font-semibold tracking-[-0.045em] text-text-primary">{formatUsd(product.pricing.amountUsd)}</span>
												<span class="text-[11px] text-text-tertiary">{product.interval === "yearly" ? m.billing_conv_per_year({}, { locale }) : m.billing_conv_per_month({}, { locale })}</span>
											</div>
											{#if note}
												<p class="mt-1 text-[10px] text-text-placeholder">{note}</p>
											{/if}
										</div>

										<ul class="mt-3 flex-1 space-y-1.5">
											{#if includedBalanceText(product)}
												<li class="flex items-start gap-2 text-[11px] leading-4 text-text-tertiary"><Check class="mt-0.5 h-3 w-3 shrink-0 text-brand" /><span>{m.billing_balance_suffix({ amount: includedBalanceText(product) }, { locale })}</span></li>
											{/if}
											{#each product.display.benefits.slice(0, 2) as benefit}
												<li class="flex items-start gap-2 text-[11px] leading-4 text-text-tertiary"><Check class="mt-0.5 h-3 w-3 shrink-0 text-brand" /><span class="line-clamp-1">{benefit}</span></li>
											{/each}
										</ul>

										<button type="button" class="mt-4 inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-[6px] px-3 text-[12px] font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-8 {recommended && !current ? 'bg-brand text-brand-contrast-fg hover:bg-brand-hover' : 'border border-border-subtle bg-bg-input text-text-primary hover:bg-bg-hover'}" disabled={catalog.payment.available === false || current} onclick={() => startCheckout(product)}>
											{#if current}
												{m.billing_conv_current_plan({}, { locale })}
											{:else}
												{m.billing_subscribe({}, { locale })}
											{/if}
										</button>
									</div>
								{/each}
							</div>
						</section>
					{:else}
					<section>
						<div class="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">{primaryLabel}</div>
						<div class="grid gap-2 sm:grid-cols-3">
							{#each primaryProducts as product (product.key)}
								<button type="button" class="group cursor-pointer rounded-[10px] border border-border-subtle bg-bg-content p-3 text-left transition-colors hover:border-brand/70 hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60" disabled={catalog.payment.available === false} onclick={() => startCheckout(product)}>
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<div class="truncate text-[13px] font-medium text-text-primary">{product.name}</div>
											<div class="mt-1 text-[12px] leading-4 text-text-tertiary">{productSubtitle(product)}</div>
										</div>
										<div class="shrink-0 font-mono text-[12px] text-text-primary">{productPrice(product)}</div>
									</div>
									{#if includedBalanceText(product)}
										<div class="mt-2 text-[11px] text-text-secondary">{m.billing_balance_included({ amount: includedBalanceText(product) }, { locale })}</div>
									{/if}
									<div class="mt-3 flex items-center gap-1.5 text-[12px] text-brand"><CreditCard class="h-3.5 w-3.5" /> {m.billing_conv_select({}, { locale })}</div>
								</button>
							{/each}
						</div>
					</section>
					{/if}

					{#if checkoutError || catalog.payment.available === false}
						<p class="mt-4 text-[12px] text-error">{checkoutError || catalog.payment.reason || m.billing_payment_unavailable_plain({}, { locale })}</p>
					{/if}
				{/if}
			</div>
		</div>
	</Sheet>
{/if}

<BillingCheckoutSheet
	open={checkoutProduct !== null}
	product={checkoutProduct}
	returnUrl={returnUrl()}
	onClose={() => (checkoutProduct = null)}
/>
