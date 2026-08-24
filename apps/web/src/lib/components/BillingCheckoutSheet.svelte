<script lang="ts">
import type {
	BillingCatalogProduct,
	BillingDiscountPricing,
	BillingPromotionCodePreview,
} from "@neta-art/cohub";
import { Check, Loader2, Tag, X } from "lucide-svelte";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import Sheet from "$lib/components/Sheet.svelte";
import { formatCurrency } from "$lib/i18n/format";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import { sdk } from "$lib/sdk";

const locale = $derived(getLocale());
const {
	open,
	product,
	returnUrl,
	onClose,
}: {
	open: boolean;
	product: BillingCatalogProduct | null;
	returnUrl: string | undefined;
	onClose: () => void;
} = $props();

let promotionCode = $state("");
let appliedPreview = $state<BillingPromotionCodePreview | null>(null);
let previewLoading = $state(false);
let checkoutLoading = $state(false);
let error = $state("");
let previousProductKey = $state<string | null>(null);
let requestGeneration = 0;

const automaticOffer = $derived(product?.offer ?? null);
const activePricing = $derived<BillingDiscountPricing | null>(
	appliedPreview?.eligible
		? appliedPreview.pricing
		: (automaticOffer?.pricing ?? null),
);
const hasAppliedCode = $derived(Boolean(appliedPreview?.eligible));
const dueToday = $derived(
	activePricing?.paidAmountUsd ?? product?.pricing.amountUsd ?? 0,
);
const discountAmount = $derived(activePricing?.discountAmountUsd ?? 0);

function resetCheckoutState() {
	promotionCode = "";
	appliedPreview = null;
	previewLoading = false;
	checkoutLoading = false;
	error = "";
}

$effect(() => {
	const productKey = open ? (product?.key ?? null) : null;
	if (productKey === previousProductKey) return;
	previousProductKey = productKey;
	requestGeneration += 1;
	resetCheckoutState();
});

function formatUsd(value: number) {
	return formatCurrency(value, "USD", {
		locale,
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function renewalLabel(item: BillingCatalogProduct) {
	const price = formatUsd(item.pricing.amountUsd);
	if (item.interval === "monthly")
		return `${price}${m.billing_checkout_per_month({}, { locale })}`;
	if (item.interval === "quarterly")
		return `${price}${m.billing_checkout_per_quarter({}, { locale })}`;
	if (item.interval === "yearly")
		return `${price}${m.billing_checkout_per_year({}, { locale })}`;
	return price;
}

function isCurrentRequest(generation: number, productKey: string) {
	return (
		generation === requestGeneration && open && product?.key === productKey
	);
}

function close() {
	requestGeneration += 1;
	previousProductKey = null;
	resetCheckoutState();
	onClose();
}

async function applyPromotionCode(event: SubmitEvent) {
	event.preventDefault();
	if (!product || previewLoading) return;
	const code = promotionCode.trim();
	if (!code) return;
	const productKey = product.key;
	const generation = requestGeneration;
	previewLoading = true;
	error = "";
	appliedPreview = null;
	try {
		const { preview } = await sdk.billing.previewPromotionCode({
			productKey,
			promotionCode: code,
		});
		if (!isCurrentRequest(generation, productKey)) return;
		promotionCode = preview.promotionCode;
		if (!preview.eligible) {
			error = preview.message ?? "This code is not available for this product.";
			return;
		}
		appliedPreview = preview;
	} catch (previewError) {
		if (!isCurrentRequest(generation, productKey)) return;
		if (await handleUnauthorizedError(previewError)) return;
		if (!isCurrentRequest(generation, productKey)) return;
		error =
			previewError instanceof Error
				? previewError.message
				: "Could not apply this code.";
	} finally {
		if (isCurrentRequest(generation, productKey)) previewLoading = false;
	}
}

function removePromotionCode() {
	promotionCode = "";
	appliedPreview = null;
	error = "";
}

async function continueToCheckout() {
	if (!product || checkoutLoading) return;
	const checkoutProduct = product;
	const generation = requestGeneration;
	checkoutLoading = true;
	error = "";
	try {
		const selection = hasAppliedCode
			? { promotionCode: appliedPreview?.promotionCode }
			: automaticOffer
				? { offer: automaticOffer.ref }
				: {};
		const result =
			checkoutProduct.kind === "plan"
				? await sdk.billing.createSubscription(checkoutProduct.key, {
						returnUrl,
						...selection,
					})
				: await sdk.billing.createOrder(checkoutProduct.key, {
						returnUrl,
						...selection,
					});
		if (!isCurrentRequest(generation, checkoutProduct.key)) return;
		if (result.checkout.checkoutUsable && result.checkout.checkoutUrl) {
			window.location.href = result.checkout.checkoutUrl;
			return;
		}
		error =
			result.checkout.payment.reason ??
			result.checkout.message ??
			"Checkout is not available.";
	} catch (checkoutError) {
		if (!isCurrentRequest(generation, checkoutProduct.key)) return;
		if (await handleUnauthorizedError(checkoutError)) return;
		if (!isCurrentRequest(generation, checkoutProduct.key)) return;
		error =
			checkoutError instanceof Error
				? checkoutError.message
				: "Checkout is not available.";
	} finally {
		if (isCurrentRequest(generation, checkoutProduct.key))
			checkoutLoading = false;
	}
}
</script>

<Sheet {open} onClose={close} maxWidth="440px">
	{#if product}
		<div class="flex max-h-[88vh] flex-col">
			<header class="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
				<div class="min-w-0">
					<h2 class="truncate text-[15px] font-semibold text-text-primary">{product.name}</h2>
					<p class="mt-0.5 text-[11px] text-text-tertiary">
						{product.kind === "plan" ? m.billing_checkout_subscription({}, { locale }) : m.billing_checkout_credit_package({}, { locale })}
					</p>
				</div>
				<button type="button" onclick={close} class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" title={m.billing_checkout_close_title({}, { locale })} aria-label={m.billing_checkout_close_aria({}, { locale })}>
					<X class="h-4 w-4" />
				</button>
			</header>

			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-safe">
				{#if automaticOffer && !hasAppliedCode}
					<div class="mb-5 flex items-center justify-between gap-3 border-b border-border-subtle pb-4">
						<div class="min-w-0">
							<div class="text-[12px] font-medium text-text-primary">{m.billing_checkout_first_purchase_offer({}, { locale })}</div>
							<div class="mt-0.5 truncate text-[11px] text-text-tertiary">{automaticOffer.name}</div>
						</div>
						<span class="shrink-0 rounded-[4px] bg-brand/12 px-2 py-1 text-[11px] font-semibold text-brand">{m.billing_checkout_off_label({}, { locale })}</span>
					</div>
				{/if}

				<div class="space-y-2.5 text-[12px]">
					<div class="flex items-center justify-between gap-4 text-text-tertiary">
						<span>{m.billing_checkout_original_price({}, { locale })}</span>
						<span class="font-mono text-text-secondary">{formatUsd(product.pricing.amountUsd)}</span>
					</div>
					{#if discountAmount > 0}
						<div class="flex items-center justify-between gap-4 text-text-tertiary">
							<span>{hasAppliedCode ? m.billing_checkout_promo_code({}, { locale }) : m.billing_checkout_first_purchase_discount({}, { locale })}</span>
							<span class="font-mono text-success-soft">-{formatUsd(discountAmount)}</span>
						</div>
					{/if}
					<div class="flex items-baseline justify-between gap-4 border-t border-border-subtle pt-3">
						<span class="font-medium text-text-primary">{m.billing_checkout_due_today({}, { locale })}</span>
						<span class="font-mono text-[18px] font-semibold text-text-primary">{formatUsd(dueToday)}</span>
					</div>
					{#if product.kind === "plan" && activePricing?.discountAmountMinor}
						<div class="flex items-center justify-between gap-4 text-[11px] text-text-tertiary">
							<span>{m.billing_checkout_renews_at({}, { locale })}</span>
							<span>{renewalLabel(product)}</span>
						</div>
					{/if}
				</div>

				<form class="mt-6" onsubmit={applyPromotionCode}>
					<label for="billing-promotion-code" class="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
						<Tag class="h-3.5 w-3.5" />
						{m.billing_checkout_promo_code({}, { locale })}
					</label>
					<div class="flex gap-2">
						<input id="billing-promotion-code" bind:value={promotionCode} disabled={previewLoading || checkoutLoading || hasAppliedCode} maxlength="256" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder={m.billing_checkout_enter_code({}, { locale })} class="h-11 min-w-0 flex-1 rounded-[5px] border border-border-subtle bg-bg-input px-3 font-mono text-[13px] uppercase text-text-primary outline-none transition-colors placeholder:normal-case placeholder:text-text-placeholder focus:border-brand disabled:opacity-60" />
						{#if hasAppliedCode}
							<button type="button" onclick={removePromotionCode} disabled={checkoutLoading} class="flex h-11 w-11 items-center justify-center rounded-[5px] border border-border-subtle text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" title={m.billing_checkout_remove_promo({}, { locale })} aria-label={m.billing_checkout_remove_promo({}, { locale })}>
								<X class="h-4 w-4" />
							</button>
						{:else}
							<button type="submit" disabled={!promotionCode.trim() || previewLoading || checkoutLoading} class="inline-flex h-11 min-w-20 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50">
								{#if previewLoading}<Loader2 class="h-4 w-4 animate-spin" />{:else}{m.billing_checkout_apply({}, { locale })}{/if}
							</button>
						{/if}
					</div>
					{#if hasAppliedCode}
						<p class="mt-2 flex items-center gap-1.5 text-[11px] text-success-soft"><Check class="h-3.5 w-3.5" /> {m.billing_checkout_code_applied({}, { locale })}</p>
					{/if}
				</form>

				{#if error}
					<p class="mt-3 text-[11px] leading-4 text-error-soft" role="alert">{error}</p>
				{/if}
			</div>

			<footer class="shrink-0 border-t border-border-subtle px-5 py-4 pb-safe">
				<button type="button" onclick={continueToCheckout} disabled={checkoutLoading || previewLoading} class="inline-flex h-11 w-full items-center justify-center rounded-[6px] bg-brand px-4 text-[13px] font-medium text-brand-contrast-fg transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55">
					{#if checkoutLoading}
						<Loader2 class="mr-1.5 h-4 w-4 animate-spin" />
						{m.billing_checkout_starting({}, { locale })}
					{:else}
						{m.billing_checkout_continue({}, { locale })}
					{/if}
				</button>
			</footer>
		</div>
	{/if}
</Sheet>
