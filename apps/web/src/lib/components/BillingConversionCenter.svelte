<script lang="ts">
import type { BillingCatalog, BillingCatalogProduct } from "@neta-art/cohub";
import { AlertCircle, Check, CreditCard, Loader2, X } from "lucide-svelte";
import { sdk } from "$lib/sdk";
import { billingConversion } from "$lib/stores/billing-conversion.svelte";

let catalog = $state<BillingCatalog | null>(null);
let loading = $state(false);
let error = $state("");
let busyKey = $state<string | null>(null);
let checkoutError = $state("");
let loadedOnce = false;

const open = $derived(billingConversion.open);
const intent = $derived(billingConversion.intent);
const warning = $derived(billingConversion.warning);
const isHard = $derived(intent?.level === "hard");
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
const addons = $derived.by(() => sortProducts(catalog?.addons ?? []));
const primaryProducts = $derived.by(() => {
	if (!catalog) return [];
	return hasActivePaidPlan ? addons.slice(0, 3) : paidPlans.slice(0, 3);
});
const secondaryProducts = $derived.by(() => {
	if (!catalog) return [];
	return hasActivePaidPlan ? paidPlans.slice(0, 2) : addons.slice(0, 2);
});
const headline = $derived(
	intent?.title ?? (isHard ? "Add credits to continue" : "Balance below zero"),
);
const message = $derived(
	intent?.message ??
		(isHard
			? "Add credits to resume AI requests."
			: "Your work can continue for now. Add credits to avoid interruption."),
);
const balanceLabel = $derived(warning ? formatUsd(warning.netUsd) : null);
const primaryLabel = $derived(
	hasActivePaidPlan ? "Add capacity" : "Choose a plan",
);
const secondaryLabel = $derived(
	hasActivePaidPlan ? "Plan options" : "One-time top-ups",
);

$effect(() => {
	if (open && !loadedOnce && !loading) {
		void loadCatalog();
	}
});

function sortProducts(products: BillingCatalogProduct[]) {
	return [...products].sort(
		(a, b) => a.pricing.amountUsd - b.pricing.amountUsd,
	);
}

function formatUsd(value: number | null | undefined) {
	if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
	}).format(value);
}

function productPrice(product: BillingCatalogProduct) {
	const price = formatUsd(product.pricing.amountUsd);
	if (product.kind === "addon") return price;
	if (product.interval === "monthly") return `${price}/mo`;
	if (product.interval === "yearly") return `${price}/yr`;
	return price;
}

function productSubtitle(product: BillingCatalogProduct) {
	if (product.display.description) return product.display.description;
	const credits =
		product.display.creditBenefits[0]?.periodAmountUsd ??
		product.display.creditsAmount;
	if (credits) return `${formatUsd(credits)} included credits`;
	return product.kind === "addon" ? "One-time credit pack" : "Workspace plan";
}

function returnUrl() {
	return typeof window === "undefined" ? undefined : window.location.href;
}

async function loadCatalog(options: { force?: boolean } = {}) {
	if (loading && !options.force) return;
	loading = true;
	error = "";
	try {
		const result = await sdk.billing.getCatalog();
		catalog = result.catalog;
		loadedOnce = true;
	} catch (loadError) {
		error =
			loadError instanceof Error
				? loadError.message
				: "Failed to load billing options";
	} finally {
		loading = false;
	}
}

async function startCheckout(product: BillingCatalogProduct) {
	if (busyKey || catalog?.payment.available === false) return;
	busyKey = product.key;
	checkoutError = "";
	try {
		const result =
			product.kind === "plan"
				? await sdk.billing.createSubscription(product.key, {
						returnUrl: returnUrl(),
					})
				: await sdk.billing.createOrder(product.key, {
						returnUrl: returnUrl(),
					});
		const checkout = result.checkout;
		if (checkout.checkoutUsable && checkout.checkoutUrl) {
			window.location.href = checkout.checkoutUrl;
			return;
		}
		checkoutError =
			checkout.payment.reason ??
			checkout.message ??
			"Checkout is not available";
	} catch (checkoutStartError) {
		checkoutError =
			checkoutStartError instanceof Error
				? checkoutStartError.message
				: "Failed to start checkout";
	} finally {
		busyKey = null;
	}
}
</script>

{#if billingConversion.hasSoftReminder && !open}
	<button
		type="button"
		class="fixed bottom-4 right-4 z-[80] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-border-subtle bg-bg-primary px-3 py-2 text-[12px] text-text-secondary shadow-2xl transition-colors hover:border-border-strong hover:text-text-primary"
		onclick={() => billingConversion.openReminder()}
	>
		<span class="h-1.5 w-1.5 rounded-full bg-brand"></span>
		<span>Balance below zero</span>
		<span class="text-text-tertiary">Add credits</span>
	</button>
{/if}

{#if open && intent}
	<div class="fixed inset-0 z-[110] flex items-end justify-center lg:items-center lg:p-4" role="dialog" aria-modal="true">
		<button class="absolute inset-0 bg-overlay-scrim" aria-label="Close billing options" onclick={() => billingConversion.close()}></button>
		<section class="relative flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-[14px] border-border-subtle bg-bg-primary shadow-2xl lg:rounded-[14px] lg:border">
			<header class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
				<div class="min-w-0">
					<div class="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-tertiary">
						<span class="h-1.5 w-1.5 rounded-full {isHard ? 'bg-error' : 'bg-brand'}"></span>
						Billing
					</div>
					<h2 class="text-[18px] font-semibold leading-6 text-text-primary">{headline}</h2>
					<p class="mt-1 max-w-[560px] text-[13px] leading-5 text-text-secondary">{message}</p>
				</div>
				<button type="button" class="rounded-[6px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => billingConversion.close()} aria-label="Close">
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				<div class="mb-4 grid gap-2 sm:grid-cols-3">
					<div class="rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2">
						<div class="text-[11px] text-text-tertiary">Current balance</div>
						<div class="mt-1 font-mono text-[13px] text-text-primary">{balanceLabel ?? "Loading"}</div>
					</div>
					<div class="rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2 sm:col-span-2">
						<div class="text-[11px] text-text-tertiary">Recommended path</div>
						<div class="mt-1 text-[13px] text-text-primary">{hasActivePaidPlan ? "Add credits for extra AI requests and generations." : "Start with a plan for included credits and higher limits."}</div>
					</div>
				</div>

				{#if loading}
					<div class="flex items-center gap-2 py-8 text-[13px] text-text-secondary"><Loader2 class="h-4 w-4 animate-spin" /> Loading billing options</div>
				{:else if error}
					<div class="rounded-[8px] border border-border-subtle bg-bg-secondary p-4">
						<div class="flex items-center gap-2 text-[13px] text-text-primary"><AlertCircle class="h-4 w-4 text-error" /> {error}</div>
						<button type="button" class="mt-3 rounded-[6px] border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary" onclick={() => loadCatalog({ force: true })}>Retry</button>
					</div>
				{:else if catalog}
					<section>
						<div class="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">{primaryLabel}</div>
						<div class="grid gap-2 sm:grid-cols-3">
							{#each primaryProducts as product (product.key)}
								<button type="button" class="group rounded-[10px] border border-border-subtle bg-bg-secondary p-3 text-left transition-colors hover:border-brand/70 hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60" disabled={!!busyKey} onclick={() => startCheckout(product)}>
									<div class="flex items-start justify-between gap-3">
										<div class="min-w-0">
											<div class="truncate text-[13px] font-medium text-text-primary">{product.name}</div>
											<div class="mt-1 text-[12px] leading-4 text-text-tertiary">{productSubtitle(product)}</div>
										</div>
										<div class="shrink-0 font-mono text-[12px] text-text-primary">{productPrice(product)}</div>
									</div>
									<div class="mt-3 flex items-center gap-1.5 text-[12px] text-brand"><CreditCard class="h-3.5 w-3.5" /> {busyKey === product.key ? "Starting" : "Select"}</div>
								</button>
							{/each}
						</div>
					</section>

					{#if secondaryProducts.length > 0}
						<section class="mt-5">
							<div class="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">{secondaryLabel}</div>
							<div class="grid gap-2 sm:grid-cols-2">
								{#each secondaryProducts as product (product.key)}
									<button type="button" class="flex items-center justify-between gap-3 rounded-[8px] border border-border-subtle px-3 py-2 text-left transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60" disabled={!!busyKey} onclick={() => startCheckout(product)}>
										<span class="min-w-0 truncate text-[12px] text-text-secondary">{product.name}</span>
										<span class="shrink-0 font-mono text-[12px] text-text-primary">{productPrice(product)}</span>
									</button>
								{/each}
							</div>
						</section>
					{/if}

					{#if checkoutError || catalog.payment.available === false}
						<p class="mt-4 text-[12px] text-error">{checkoutError || catalog.payment.reason || "Payment is not available"}</p>
					{/if}
				{/if}
			</div>

			<footer class="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3 text-[12px] text-text-tertiary">
				<div class="flex items-center gap-1.5"><Check class="h-3.5 w-3.5" /> Checkout returns you here.</div>
				<button type="button" class="text-text-secondary hover:text-text-primary" onclick={() => billingConversion.close()}>Not now</button>
			</footer>
		</section>
	</div>
{/if}
