<script lang="ts">
import type {
	BillingCatalogProduct,
	SpaceCommerceFeatureBenefit,
	SpaceCommerceOrder,
} from "@neta-art/cohub";
import { Check, Link, Loader2, PackagePlus, Plus } from "lucide-svelte";
import { goto } from "$app/navigation";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceSettingsRoute } from "$lib/space-routes";

const props = $props<{ data: { spaceId: string } }>();
const spaceId = $derived(props.data.spaceId);

let loading = $state(true);
let error = $state("");
let products = $state<BillingCatalogProduct[]>([]);
let benefits = $state<SpaceCommerceFeatureBenefit[]>([]);
let orders = $state<SpaceCommerceOrder[]>([]);
let productSaving = $state(false);
let benefitSaving = $state(false);
let bindingSaving = $state(false);
let formError = $state("");
let productKey = $state("");
let productName = $state("");
let productDescription = $state("");
let productAmountUsd = $state("9.99");
let benefitKey = $state("");
let benefitName = $state("");
let benefitDescription = $state("");
let benefitMetadata = $state('{"enabled": true}');
let bindProductKey = $state("");
let bindBenefitKey = $state("");
let notice = $state("");
let commerceInitialized = $state(true);
let setupSaving = $state(false);
let productActionBusyKey = $state<string | null>(null);
let benefitActionBusyKey = $state<string | null>(null);
let bindingActionBusyKey = $state<string | null>(null);

async function loadPage() {
	loading = true;
	error = "";
	try {
		const [productResult, benefitResult, orderResult] = await Promise.all([
			sdk.space(spaceId).commerce.listProducts(),
			sdk.space(spaceId).commerce.listBenefits(),
			sdk.space(spaceId).commerce.listOrders(),
		]);
		products = productResult.products;
		benefits = benefitResult.benefits as SpaceCommerceFeatureBenefit[];
		orders = orderResult.orders as SpaceCommerceOrder[];
	} catch (err) {
		const message =
			err instanceof Error ? err.message : "Failed to load commerce.";
		if (message.includes("not initialized")) {
			commerceInitialized = false;
			error = "";
			products = [];
			benefits = [];
			orders = [];
		} else {
			error = message;
		}
	} finally {
		loading = false;
	}
}

function resetProductForm() {
	productKey = "";
	productName = "";
	productDescription = "";
	productAmountUsd = "9.99";
}

function resetBenefitForm() {
	benefitKey = "";
	benefitName = "";
	benefitDescription = "";
	benefitMetadata = '{"enabled": true}';
}

async function setupCommerce() {
	if (setupSaving) return;
	formError = "";
	notice = "";
	setupSaving = true;
	try {
		await sdk.space(spaceId).commerce.setup();
		commerceInitialized = true;
		notice = "Commerce is ready.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to initialize commerce.";
	} finally {
		setupSaving = false;
	}
}

async function createProduct() {
	if (productSaving) return;
	formError = "";
	notice = "";
	productSaving = true;
	try {
		await sdk.space(spaceId).commerce.createProduct({
			key: productKey.trim(),
			name: productName.trim(),
			description: productDescription.trim() || undefined,
			amountUsd: Number(productAmountUsd),
			status: "active",
			visibility: "public",
		});
		resetProductForm();
		notice = "Product created.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to create product.";
	} finally {
		productSaving = false;
	}
}

async function createBenefit() {
	if (benefitSaving) return;
	formError = "";
	notice = "";
	benefitSaving = true;
	try {
		const metadata = JSON.parse(benefitMetadata) as Record<
			string,
			string | number | boolean
		>;
		await sdk.space(spaceId).commerce.createBenefit({
			key: benefitKey.trim(),
			name: benefitName.trim(),
			description: benefitDescription.trim() || undefined,
			metadata,
		});
		resetBenefitForm();
		notice = "Benefit created.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to create benefit.";
	} finally {
		benefitSaving = false;
	}
}

async function archiveProduct(product: BillingCatalogProduct) {
	if (productActionBusyKey) return;
	formError = "";
	notice = "";
	productActionBusyKey = product.key;
	try {
		await sdk
			.space(spaceId)
			.commerce.updateProduct(product.key, { status: "archived" });
		notice = "Product archived.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to archive product.";
	} finally {
		productActionBusyKey = null;
	}
}

async function archiveBenefit(benefit: SpaceCommerceFeatureBenefit) {
	if (benefitActionBusyKey) return;
	formError = "";
	notice = "";
	benefitActionBusyKey = benefit.key;
	try {
		await sdk
			.space(spaceId)
			.commerce.updateBenefit(benefit.key, { status: "archived" });
		notice = "Benefit archived.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to archive benefit.";
	} finally {
		benefitActionBusyKey = null;
	}
}

async function unbindBenefit() {
	if (bindingActionBusyKey) return;
	formError = "";
	notice = "";
	bindingActionBusyKey = `${bindProductKey}:${bindBenefitKey}`;
	try {
		await sdk.space(spaceId).commerce.unbindProductBenefit({
			productKey: bindProductKey.trim(),
			benefitKey: bindBenefitKey.trim(),
		});
		notice = "Benefit detached.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to detach benefit.";
	} finally {
		bindingActionBusyKey = null;
	}
}

async function bindBenefit() {
	if (bindingSaving) return;
	formError = "";
	notice = "";
	bindingSaving = true;
	try {
		await sdk.space(spaceId).commerce.bindProductBenefit({
			productKey: bindProductKey.trim(),
			benefitKey: bindBenefitKey.trim(),
		});
		notice = "Benefit attached.";
		await loadPage();
	} catch (err) {
		formError =
			err instanceof Error ? err.message : "Failed to attach benefit.";
	} finally {
		bindingSaving = false;
	}
}

$effect(() => {
	void loadPage();
});
</script>

<svelte:head><title>Space commerce — Cohub</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-primary">
  <header class="flex h-[44px] shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-3 sm:px-4">
    <div class="flex min-w-0 items-center gap-3">
      <button type="button" class="inline-flex h-8 items-center justify-center rounded-[6px] px-2.5 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => goto(buildSpaceSettingsRoute(spaceId))}>Back</button>
      <div class="truncate text-[13px] font-medium text-text-primary">Space commerce</div>
    </div>
  </header>

  <main class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
    <div class="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
      {#if loading}
        <CenteredLoading label="Loading commerce…" size="compact" variant="surface" />
      {:else if error}
        <div class="rounded-[8px] border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{error}</div>
      {:else if !commerceInitialized}
        <section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
          <div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><PackagePlus class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Commerce is not initialized</div><div class="text-[12px] text-text-tertiary">Create the billing business mapping for this space before adding products and benefits.</div></div></div></div>
          <div class="flex items-center justify-between gap-3 p-4 sm:p-5">
            <div class="text-[12px] text-text-tertiary">This is a one-time setup for the current space.</div>
            <button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void setupCommerce()} disabled={setupSaving}>{#if setupSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<PackagePlus class="h-3.5 w-3.5" />{/if}Initialize</button>
          </div>
        </section>
      {:else}
        {#if formError}
          <div class="rounded-[8px] border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{formError}</div>
        {/if}
        {#if notice}
          <div class="rounded-[8px] border border-success-soft/30 bg-success-bg p-3 text-[12px] text-success-soft">{notice}</div>
        {/if}

        <section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
          <div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><PackagePlus class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Products</div><div class="text-[12px] text-text-tertiary">Create public one-time products for this space.</div></div></div></div>
          <div class="space-y-4 p-4 sm:p-5">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input bind:value={productKey} placeholder="product key" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary" />
              <input bind:value={productName} placeholder="Product name" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary" />
              <input bind:value={productAmountUsd} placeholder="9.99" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary" />
              <button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void createProduct()} disabled={productSaving}>{#if productSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if}Create</button>
            </div>
            <input bind:value={productDescription} placeholder="Description (optional)" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary" />
            <div class="space-y-2">{#each products as product (product.key)}<div class="rounded-[7px] bg-bg-primary px-3 py-2"><div class="flex flex-wrap items-center justify-between gap-3"><div><div class="font-mono text-[12px] text-text-primary">{product.key}</div><div class="text-[12px] text-text-secondary">{product.name}</div></div><div class="flex items-center gap-3"><div class="text-[12px] text-text-tertiary">${product.pricing.amountUsd.toFixed(2)}</div><button type="button" class="text-[11px] text-text-placeholder hover:text-error-soft disabled:opacity-50" onclick={() => void archiveProduct(product)} disabled={productActionBusyKey !== null || product.status === 'archived'}>{productActionBusyKey === product.key ? 'Working…' : product.status === 'archived' ? 'Archived' : 'Archive'}</button></div></div></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No products.</div>{/each}</div>
          </div>
        </section>

        <section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
          <div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><Link class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Benefits</div><div class="text-[12px] text-text-tertiary">Create shared space-level feature benefits.</div></div></div></div>
          <div class="space-y-4 p-4 sm:p-5">
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input bind:value={benefitKey} placeholder="benefit key" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary" />
              <input bind:value={benefitName} placeholder="Benefit name" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary" />
              <input bind:value={benefitDescription} placeholder="Description (optional)" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-primary" />
              <button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void createBenefit()} disabled={benefitSaving}>{#if benefitSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Plus class="h-3.5 w-3.5" />{/if}Create</button>
            </div>
            <textarea bind:value={benefitMetadata} rows="3" class="w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary"></textarea>
            <div class="space-y-2">{#each benefits as benefit (benefit.key)}<div class="rounded-[7px] bg-bg-primary px-3 py-2"><div class="flex flex-wrap items-center justify-between gap-3"><div><div class="font-mono text-[12px] text-text-primary">{benefit.key}</div><div class="text-[12px] text-text-secondary">{benefit.name}</div></div><button type="button" class="text-[11px] text-text-placeholder hover:text-error-soft disabled:opacity-50" onclick={() => void archiveBenefit(benefit)} disabled={benefitActionBusyKey !== null || benefit.status === 'archived'}>{benefitActionBusyKey === benefit.key ? 'Working…' : benefit.status === 'archived' ? 'Archived' : 'Archive'}</button></div></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No benefits.</div>{/each}</div>
          </div>
        </section>

        <section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
          <div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div class="flex items-center gap-2.5"><Check class="h-4 w-4 text-text-tertiary" /><div><div class="text-[15px] font-medium text-text-primary">Bindings</div><div class="text-[12px] text-text-tertiary">Attach a benefit to a product.</div></div></div></div>
          <div class="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:p-5">
            <input bind:value={bindProductKey} placeholder="product key" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary" />
            <input bind:value={bindBenefitKey} placeholder="benefit key" class="rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 font-mono text-[12px] text-text-primary" />
            <div class="flex gap-2"><button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void bindBenefit()} disabled={bindingSaving}>{#if bindingSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Check class="h-3.5 w-3.5" />{/if}Attach</button><button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] text-text-secondary disabled:opacity-50" onclick={() => void unbindBenefit()} disabled={bindingActionBusyKey !== null}>Detach</button></div>
          </div>
        </section>

        <section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
          <div class="border-b border-border-subtle px-4 py-3 sm:px-5"><div><div class="text-[15px] font-medium text-text-primary">Orders</div><div class="text-[12px] text-text-tertiary">Recent orders for this space.</div></div></div>
          <div class="space-y-2 p-4 sm:p-5">{#each orders as order (order.id)}<div class="rounded-[7px] bg-bg-primary px-3 py-2"><div class="flex flex-wrap items-center justify-between gap-2"><div><div class="font-mono text-[11px] text-text-placeholder">{order.id}</div><div class="text-[12px] text-text-primary">{order.productNameSnapshot}</div><div class="text-[11px] text-text-tertiary">{order.productKeySnapshot}</div></div><div class="text-right"><div class="text-[12px] text-text-primary">${((order.paidAmountSnapshot > 0 ? order.paidAmountSnapshot : order.amountSnapshot) / 100).toFixed(2)}</div><div class="text-[11px] text-text-tertiary">{order.status}</div></div></div></div>{:else}<div class="rounded-[7px] bg-bg-primary px-3 py-2 text-[12px] text-text-tertiary">No orders.</div>{/each}</div>
        </section>
      {/if}
    </div>
  </main>
</div>
