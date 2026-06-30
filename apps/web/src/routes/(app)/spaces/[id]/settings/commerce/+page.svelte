<script lang="ts">
import type {
	BillingCatalogProduct,
	SpaceCommerceFeatureBenefit,
	SpaceCommerceOrder,
} from "@neta-art/cohub";
import {
	Archive,
	ChevronDown,
	Link2,
	Loader2,
	Package,
	Pencil,
	Plus,
	Sparkles,
} from "lucide-svelte";
import { goto } from "$app/navigation";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import CommerceBenefitEditor from "$lib/components/commerce/CommerceBenefitEditor.svelte";
import CommerceProductEditor from "$lib/components/commerce/CommerceProductEditor.svelte";
import Dialog from "$lib/components/Dialog.svelte";
import { sdk } from "$lib/sdk";
import { buildSpaceSettingsRoute } from "$lib/space-routes";

type MetaValue = string | number | boolean;

type DialogState =
	| { kind: "none" }
	| { kind: "benefit-create" }
	| { kind: "benefit-edit"; benefit: SpaceCommerceFeatureBenefit }
	| { kind: "product-create" }
	| { kind: "product-edit"; product: BillingCatalogProduct };

const NOT_INITIALIZED_CODE = "space_commerce_not_initialized";

const props = $props<{ data: { spaceId: string } }>();
const spaceId = $derived(props.data.spaceId);

let loading = $state(true);
let loadError = $state("");
let commerceInitialized = $state(true);
let products = $state<BillingCatalogProduct[]>([]);
let benefits = $state<SpaceCommerceFeatureBenefit[]>([]);
let orders = $state<SpaceCommerceOrder[]>([]);

let notice = $state("");
let actionError = $state("");

let dialog = $state<DialogState>({ kind: "none" });
let benefitSaving = $state(false);
let productSaving = $state(false);
let setupSaving = $state(false);
let productActionBusyKey = $state<string | null>(null);
let benefitActionBusyKey = $state<string | null>(null);
let bindingSaving = $state(false);
let bindingMode = $state<"attach" | "detach">("attach");
let bindProductKey = $state("");
let bindBenefitKey = $state("");
let ordersExpanded = $state(false);
let ordersLoading = $state(false);

const bindableProducts = $derived(
	products.filter((product) => product.status !== "archived"),
);
const bindableBenefits = $derived(
	benefits.filter((benefit) => benefit.status !== "archived"),
);

const readinessSteps = $derived([
	{ label: "Setup", done: commerceInitialized, count: null as number | null },
	{ label: "Benefits", done: benefits.length > 0, count: benefits.length },
	{ label: "Products", done: products.length > 0, count: products.length },
]);
const productsWithoutBenefitsHint = $derived(
	commerceInitialized && products.length > 0 && benefits.length === 0,
);

function isNotInitializedError(error: unknown): boolean {
	if (error instanceof Error) {
		const code = (error as { code?: unknown }).code;
		if (code === NOT_INITIALIZED_CODE) return true;
		return error.message.includes("not initialized");
	}
	return false;
}

function messageOf(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

async function loadInitial(targetSpaceId: string = spaceId) {
	loading = true;
	loadError = "";
	commerceInitialized = true;
	let stale = false;
	try {
		const [productResult, benefitResult, orderResult] = await Promise.all([
			sdk.space(targetSpaceId).commerce.listProducts(),
			sdk.space(targetSpaceId).commerce.listBenefits(),
			sdk.space(targetSpaceId).commerce.listOrders(),
		]);
		stale = targetSpaceId !== spaceId;
		if (stale) return;
		products = productResult.products;
		benefits = benefitResult.benefits as SpaceCommerceFeatureBenefit[];
		orders = orderResult.orders as SpaceCommerceOrder[];
	} catch (error) {
		stale = targetSpaceId !== spaceId;
		if (stale) return;
		if (isNotInitializedError(error)) {
			commerceInitialized = false;
			products = [];
			benefits = [];
			orders = [];
		} else {
			loadError = messageOf(error, "Failed to load commerce.");
		}
	} finally {
		if (!stale) loading = false;
	}
}

async function refreshProducts() {
	try {
		const { products: next } = await sdk.space(spaceId).commerce.listProducts();
		products = next;
	} catch (error) {
		actionError = messageOf(error, "Failed to refresh products.");
	}
}

async function refreshBenefits() {
	try {
		const { benefits: next } = await sdk.space(spaceId).commerce.listBenefits();
		benefits = next as SpaceCommerceFeatureBenefit[];
	} catch (error) {
		actionError = messageOf(error, "Failed to refresh benefits.");
	}
}

async function refreshOrders() {
	ordersLoading = true;
	try {
		const { orders: next } = await sdk.space(spaceId).commerce.listOrders();
		orders = next as SpaceCommerceOrder[];
	} catch (error) {
		actionError = messageOf(error, "Failed to refresh orders.");
	} finally {
		ordersLoading = false;
	}
}

function clearNotice() {
	notice = "";
	actionError = "";
}

/** Dismiss the editor dialog, but not while a save is in flight so that
 * failures always surface inline instead of being lost on unmount. */
function closeDialog() {
	if (benefitSaving || productSaving) return;
	dialog = { kind: "none" };
}

async function setupCommerce() {
	if (setupSaving) return;
	clearNotice();
	setupSaving = true;
	try {
		await sdk.space(spaceId).commerce.setup();
		commerceInitialized = true;
		notice = "Commerce is ready.";
		await loadInitial();
	} catch (error) {
		actionError = messageOf(error, "Failed to initialize commerce.");
	} finally {
		setupSaving = false;
	}
}

// ---- Benefits ----

async function submitBenefit(input: {
	key: string;
	name: string;
	description?: string;
	metadata: Record<string, MetaValue>;
}) {
	benefitSaving = true;
	clearNotice();
	try {
		if (dialog.kind === "benefit-edit") {
			await sdk.space(spaceId).commerce.updateBenefit(dialog.benefit.key, {
				name: input.name,
				description: input.description ?? null,
				metadata: input.metadata,
			});
			notice = "Benefit updated.";
		} else {
			await sdk.space(spaceId).commerce.createBenefit({
				key: input.key,
				name: input.name,
				description: input.description,
				metadata: input.metadata,
			});
			notice = "Benefit created.";
		}
		dialog = { kind: "none" };
		await refreshBenefits();
	} finally {
		benefitSaving = false;
	}
	// Errors propagate to the editor, which shows them inline (the page-level
	// banner is hidden behind the dialog overlay while it is open).
}

async function archiveBenefit(benefit: SpaceCommerceFeatureBenefit) {
	if (benefitActionBusyKey || benefit.status === "archived") return;
	if (!window.confirm(`Archive benefit "${benefit.name}"?`)) return;
	benefitActionBusyKey = benefit.key;
	clearNotice();
	try {
		await sdk
			.space(spaceId)
			.commerce.updateBenefit(benefit.key, { status: "archived" });
		notice = "Benefit archived.";
		await refreshBenefits();
	} catch (error) {
		actionError = messageOf(error, "Failed to archive benefit.");
	} finally {
		benefitActionBusyKey = null;
	}
}

// ---- Products ----

async function submitProduct(input: {
	key: string;
	name: string;
	description?: string;
	amountUsd: number;
	status: "draft" | "active";
	visibility: "public" | "private";
}) {
	productSaving = true;
	clearNotice();
	try {
		if (dialog.kind === "product-edit") {
			await sdk.space(spaceId).commerce.updateProduct(dialog.product.key, {
				name: input.name,
				description: input.description ?? null,
				status: input.status,
				visibility: input.visibility,
			});
			notice = "Product updated.";
		} else {
			await sdk.space(spaceId).commerce.createProduct({
				key: input.key,
				name: input.name,
				description: input.description,
				amountUsd: input.amountUsd,
				status: input.status,
				visibility: input.visibility,
			});
			notice = "Product created.";
		}
		dialog = { kind: "none" };
		await refreshProducts();
	} finally {
		productSaving = false;
	}
	// Errors propagate to the editor, which shows them inline (the page-level
	// banner is hidden behind the dialog overlay while it is open).
}

async function archiveProduct(product: BillingCatalogProduct) {
	if (productActionBusyKey || product.status === "archived") return;
	if (!window.confirm(`Archive product "${product.name}"?`)) return;
	productActionBusyKey = product.key;
	clearNotice();
	try {
		await sdk
			.space(spaceId)
			.commerce.updateProduct(product.key, { status: "archived" });
		notice = "Product archived.";
		await refreshProducts();
	} catch (error) {
		actionError = messageOf(error, "Failed to archive product.");
	} finally {
		productActionBusyKey = null;
	}
}

// ---- Bindings ----

const bindingReady = $derived(
	Boolean(bindProductKey) && Boolean(bindBenefitKey),
);

async function applyBinding() {
	if (bindingSaving || !bindingReady) return;
	bindingSaving = true;
	clearNotice();
	const productKey = bindProductKey.trim();
	const benefitKey = bindBenefitKey.trim();
	try {
		if (bindingMode === "attach") {
			await sdk.space(spaceId).commerce.bindProductBenefit({
				productKey,
				benefitKey,
			});
			notice = `Benefit “${benefitKey}” linked to “${productKey}”.`;
		} else {
			await sdk.space(spaceId).commerce.unbindProductBenefit({
				productKey,
				benefitKey,
			});
			notice = `Benefit “${benefitKey}” unlinked from “${productKey}”.`;
		}
		bindBenefitKey = "";
	} catch (error) {
		actionError = messageOf(
			error,
			bindingMode === "attach"
				? "Failed to link benefit."
				: "Failed to unlink benefit.",
		);
	} finally {
		bindingSaving = false;
	}
}

// ---- Formatting helpers ----

function formatPrice(product: BillingCatalogProduct): string {
	return `$${product.pricing.amountUsd.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function metadataEntries(
	benefit: SpaceCommerceFeatureBenefit,
): Array<{ key: string; value: string }> {
	return Object.entries(benefit.config.metadata).map(([key, value]) => ({
		key,
		value:
			typeof value === "boolean" ? (value ? "true" : "false") : String(value),
	}));
}

function orderAmount(order: SpaceCommerceOrder): string {
	const amount =
		order.paidAmountSnapshot > 0
			? order.paidAmountSnapshot
			: order.amountSnapshot;
	return `$${(amount / 100).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function formatDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

$effect(() => {
	const targetSpaceId = spaceId;
	void loadInitial(targetSpaceId);
});
</script>

<svelte:head><title>Commerce — Cohub</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-primary">
	<header class="flex h-[44px] shrink-0 items-center justify-between border-b border-border-subtle bg-bg-primary px-3 sm:px-4">
		<div class="flex min-w-0 items-center gap-3">
			<button type="button" class="inline-flex h-8 items-center justify-center rounded-[6px] px-2.5 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary" onclick={() => goto(buildSpaceSettingsRoute(spaceId))}>Back</button>
			<div class="truncate text-[13px] font-medium text-text-primary">Commerce</div>
		</div>
	</header>

	<main class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6">
		<div class="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
			{#if loading}
				<CenteredLoading label="Loading commerce…" size="compact" variant="surface" />
			{:else if loadError}
				<div class="rounded-[8px] border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{loadError}</div>
			{:else if !commerceInitialized}
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="border-b border-border-subtle px-4 py-3 sm:px-5">
						<div class="flex items-center gap-2.5">
							<Sparkles class="h-4 w-4 text-text-tertiary" />
							<div>
								<div class="text-[15px] font-medium text-text-primary">Commerce is not initialized</div>
								<div class="text-[12px] text-text-tertiary">Create the billing business mapping for this space to start selling products.</div>
							</div>
						</div>
					</div>
					<div class="flex items-center justify-between gap-3 p-4 sm:p-5">
						<div class="text-[12px] text-text-tertiary">This is a one-time setup for the current space.</div>
						<button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void setupCommerce()} disabled={setupSaving}>
							{#if setupSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Sparkles class="h-3.5 w-3.5" />{/if}
							Initialize
						</button>
					</div>
				</section>
			{:else}
				<!-- Readiness bar -->
				<div class="rounded-[10px] border border-border-subtle bg-bg-surface px-4 py-3 sm:px-5">
					<div class="flex flex-wrap items-center gap-x-2 gap-y-2">
						{#each readinessSteps as step, i (step.label)}
							<div class="flex items-center gap-2">
								{#if i > 0}
									<span class="mx-1 h-px w-5 bg-border-subtle sm:w-7" aria-hidden="true"></span>
								{/if}
<span class="inline-block h-2 w-2 shrink-0 rounded-full {step.done ? 'bg-brand' : 'border border-border-subtle bg-transparent'}" aria-hidden="true"></span>
								<span class="text-[12px] font-medium {step.done ? 'text-text-primary' : 'text-text-tertiary'}">
									{step.label}{#if step.count !== null && step.count > 0}<span class="ml-1 text-text-tertiary">· {step.count}</span>{/if}
								</span>
							</div>
						{/each}
					</div>
					{#if productsWithoutBenefitsHint}
						<div class="mt-2.5 text-[11px] text-text-tertiary">Tip: add a benefit, then link it to a product so purchases grant access.</div>
					{/if}
				</div>

				{#if actionError}
					<div class="rounded-[8px] border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">{actionError}</div>
				{/if}
				{#if notice}
					<div class="rounded-[8px] border border-success-soft/30 bg-success-bg p-3 text-[12px] text-success-soft">{notice}</div>
				{/if}

				<!-- Benefits -->
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
						<div class="flex items-center gap-2.5">
							<Sparkles class="h-4 w-4 text-text-tertiary" />
							<div>
								<div class="text-[15px] font-medium text-text-primary">Benefits</div>
								<div class="text-[12px] text-text-tertiary">Reusable feature entitlements linked to products.</div>
							</div>
						</div>
						<button type="button" class="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => { clearNotice(); dialog = { kind: "benefit-create" }; }}>
							<Plus class="h-3.5 w-3.5" /> New benefit
						</button>
					</div>
					<div class="p-4 sm:p-5">
						{#if benefits.length === 0}
							<div class="rounded-[8px] border border-dashed border-border-subtle px-4 py-6 text-center">
								<div class="text-[13px] font-medium text-text-secondary">No benefits yet</div>
								<div class="mt-1 text-[12px] text-text-tertiary">Create a feature benefit to gate access to platform capabilities.</div>
								<button type="button" class="mt-3 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover" onclick={() => { clearNotice(); dialog = { kind: "benefit-create" }; }}>
									<Plus class="h-3.5 w-3.5" /> Create benefit
								</button>
							</div>
						{:else}
							<div class="grid gap-2.5">
								{#each benefits as benefit (benefit.key)}
									{@const entries = metadataEntries(benefit)}
									{@const archived = benefit.status === "archived"}
									<div class="rounded-[8px] border border-border-subtle bg-bg-primary px-3.5 py-3 {archived ? 'opacity-60' : ''}">
										<div class="flex flex-wrap items-start justify-between gap-3">
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-2">
													<span class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full {archived ? 'bg-text-placeholder' : 'bg-brand'}" aria-hidden="true"></span>
													<span class="text-[13px] font-medium text-text-primary {archived ? 'line-through' : ''}">{benefit.name}</span>
													<span class="rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">Feature</span>
													{#if archived}<span class="rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-placeholder">Archived</span>{/if}
												</div>
												<div class="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{benefit.key}</div>
												{#if benefit.description}<div class="mt-1 text-[12px] text-text-secondary">{benefit.description}</div>{/if}
												{#if entries.length > 0}
													<div class="mt-2 flex flex-wrap gap-1.5">
														{#each entries.slice(0, 4) as entry (entry.key)}
															<span class="inline-flex items-center rounded-[4px] bg-bg-subtle px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
																<span class="text-text-tertiary">{entry.key}</span><span class="mx-1 text-text-placeholder">:</span>{entry.value}
															</span>
														{/each}
														{#if entries.length > 4}<span class="inline-flex items-center px-1 py-0.5 text-[10px] text-text-placeholder">+{entries.length - 4} more</span>{/if}
													</div>
												{/if}
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" onclick={() => { clearNotice(); dialog = { kind: "benefit-edit", benefit }; }} disabled={benefitActionBusyKey !== null || archived}>
													<Pencil class="h-3 w-3" /> Edit
												</button>
												<button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium text-text-placeholder transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50" onclick={() => void archiveBenefit(benefit)} disabled={benefitActionBusyKey !== null || archived}>
													{#if benefitActionBusyKey === benefit.key}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Archive class="h-3 w-3" />{/if}
													Archive
												</button>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>

				<!-- Products -->
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
						<div class="flex items-center gap-2.5">
							<Package class="h-4 w-4 text-text-tertiary" />
							<div>
								<div class="text-[15px] font-medium text-text-primary">Products</div>
								<div class="text-[12px] text-text-tertiary">One-time purchases buyers can check out.</div>
							</div>
						</div>
						<button type="button" class="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => { clearNotice(); dialog = { kind: "product-create" }; }}>
							<Plus class="h-3.5 w-3.5" /> New product
						</button>
					</div>
					<div class="p-4 sm:p-5">
						{#if products.length === 0}
							<div class="rounded-[8px] border border-dashed border-border-subtle px-4 py-6 text-center">
								<div class="text-[13px] font-medium text-text-secondary">No products yet</div>
								<div class="mt-1 text-[12px] text-text-tertiary">Create a product to start selling.</div>
								<button type="button" class="mt-3 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-3 py-2 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover" onclick={() => { clearNotice(); dialog = { kind: "product-create" }; }}>
									<Plus class="h-3.5 w-3.5" /> Create product
								</button>
							</div>
						{:else}
							<div class="grid gap-2.5 sm:grid-cols-2">
								{#each products as product (product.key)}
									{@const archived = product.status === "archived"}
									{@const draft = product.status === "draft"}
									<div class="flex flex-col rounded-[8px] border border-border-subtle bg-bg-primary px-3.5 py-3 {archived ? 'opacity-60' : ''}">
										<div class="flex items-start justify-between gap-2">
											<div class="min-w-0">
												<div class="flex flex-wrap items-center gap-2">
													<span class="text-[13px] font-medium text-text-primary {archived ? 'line-through' : ''}">{product.name}</span>
													<span class="rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">One-time</span>
												</div>
												<div class="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">{product.key}</div>
											</div>
											<div class="text-right">
												<div class="font-mono text-[14px] font-semibold text-text-primary">{formatPrice(product)}</div>
											</div>
										</div>

										<div class="mt-2 flex flex-wrap items-center gap-1.5">
											<span class="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide {archived ? 'text-text-placeholder' : draft ? 'text-text-tertiary' : 'text-brand'}">
												<span class="h-1.5 w-1.5 rounded-full {archived ? 'bg-text-placeholder' : draft ? 'bg-text-tertiary' : 'bg-brand'}" aria-hidden="true"></span>
												{product.status}
											</span>
											<span class="rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">{product.visibility}</span>
										</div>

										{#if product.description}
											<p class="mt-2 line-clamp-2 text-[12px] leading-5 text-text-secondary">{product.description}</p>
										{/if}

										<div class="mt-3 flex items-center gap-1 border-t border-border-subtle pt-2.5">
											<button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" onclick={() => { clearNotice(); dialog = { kind: "product-edit", product }; }} disabled={productActionBusyKey !== null || archived}>
												<Pencil class="h-3 w-3" /> Edit
											</button>
											<button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[11px] font-medium text-text-placeholder transition-colors hover:bg-bg-hover hover:text-error-soft disabled:opacity-50" onclick={() => void archiveProduct(product)} disabled={productActionBusyKey !== null || archived}>
												{#if productActionBusyKey === product.key}<Loader2 class="h-3 w-3 animate-spin" />{:else}<Archive class="h-3 w-3" />{/if}
												Archive
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</section>

				<!-- Link benefits to products -->
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<div class="border-b border-border-subtle px-4 py-3 sm:px-5">
						<div class="flex items-center gap-2.5">
							<Link2 class="h-4 w-4 text-text-tertiary" />
							<div>
								<div class="text-[15px] font-medium text-text-primary">Link benefits</div>
								<div class="text-[12px] text-text-tertiary">Attach a benefit to a product so purchases grant it.</div>
							</div>
						</div>
					</div>
					<div class="space-y-3 p-4 sm:p-5">
						{#if bindableProducts.length === 0 || bindableBenefits.length === 0}
							<div class="rounded-[8px] border border-dashed border-border-subtle px-4 py-5 text-center text-[12px] text-text-tertiary">
								{#if bindableProducts.length === 0 && bindableBenefits.length === 0}
									Create at least one product and one benefit to link them.
								{:else if bindableProducts.length === 0}
									Create a product to link benefits to it.
								{:else}
									Create a benefit to link it to a product.
								{/if}
							</div>
						{:else}
							<div class="inline-flex rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
								<button type="button" class="rounded-[5px] px-3 py-1.5 transition-colors {bindingMode === 'attach' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}" onclick={() => (bindingMode = "attach")}>Attach</button>
								<button type="button" class="rounded-[5px] px-3 py-1.5 transition-colors {bindingMode === 'detach' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}" onclick={() => (bindingMode = "detach")}>Detach</button>
							</div>
							<div class="grid gap-3 sm:grid-cols-2">
								<label class="flex flex-col gap-1.5">
									<span class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Product</span>
									<select bind:value={bindProductKey} disabled={bindingSaving} class="h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60">
										<option value="">Select a product…</option>
										{#each bindableProducts as product (product.key)}
											<option value={product.key}>{product.name} · {product.key}</option>
										{/each}
									</select>
								</label>
								<label class="flex flex-col gap-1.5">
									<span class="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Benefit</span>
									<select bind:value={bindBenefitKey} disabled={bindingSaving} class="h-9 w-full rounded-[6px] border border-border-subtle bg-bg-input px-3 text-[13px] text-text-primary transition-colors focus:border-brand/50 focus:outline-none disabled:opacity-60">
										<option value="">Select a benefit…</option>
										{#each bindableBenefits as benefit (benefit.key)}
											<option value={benefit.key}>{benefit.name} · {benefit.key}</option>
										{/each}
									</select>
								</label>
							</div>
							<div class="flex items-center justify-between gap-3">
								<span class="text-[11px] text-text-tertiary">Links are applied immediately and verified at checkout.</span>
								<button type="button" class="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[6px] bg-brand px-3 py-2 text-[12px] font-medium text-brand-contrast-fg disabled:opacity-50" onclick={() => void applyBinding()} disabled={bindingSaving || !bindingReady}>
									{#if bindingSaving}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Link2 class="h-3.5 w-3.5" />{/if}
									{bindingMode === "attach" ? "Attach" : "Detach"}
								</button>
							</div>
						{/if}
					</div>
				</section>

				<!-- Orders -->
				<section class="overflow-hidden rounded-[10px] border border-border-subtle bg-bg-surface">
					<button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover sm:px-5" onclick={() => { ordersExpanded = !ordersExpanded; if (ordersExpanded && orders.length === 0) void refreshOrders(); }}>
						<div class="flex items-center gap-2.5">
							<Package class="h-4 w-4 text-text-tertiary" />
							<div>
								<div class="text-[15px] font-medium text-text-primary">Orders</div>
								<div class="text-[12px] text-text-tertiary">Recent purchases for this space.</div>
							</div>
						</div>
						<ChevronDown class="h-4 w-4 shrink-0 text-text-tertiary transition-transform {ordersExpanded ? 'rotate-180' : ''}" />
					</button>
					{#if ordersExpanded}
						<div class="border-t border-border-subtle p-4 sm:p-5">
							{#if ordersLoading}
								<div class="flex items-center gap-2 py-4 text-[12px] text-text-tertiary"><Loader2 class="h-3.5 w-3.5 animate-spin" /> Loading orders…</div>
							{:else if orders.length === 0}
								<div class="py-4 text-center text-[12px] text-text-tertiary">No orders yet.</div>
							{:else}
								<div class="grid gap-2">
									{#each orders as order (order.id)}
										<div class="flex flex-wrap items-center justify-between gap-2 rounded-[7px] bg-bg-primary px-3 py-2">
											<div class="min-w-0">
												<div class="truncate text-[12px] font-medium text-text-primary">{order.productNameSnapshot}</div>
												<div class="mt-0.5 flex items-center gap-2">
													<span class="truncate font-mono text-[10px] text-text-placeholder">{order.productKeySnapshot}</span>
													<span class="text-[10px] text-text-tertiary">{formatDate(order.createdAt)}</span>
												</div>
											</div>
											<div class="text-right">
												<div class="font-mono text-[12px] text-text-primary">{orderAmount(order)}</div>
												<div class="text-[10px] uppercase tracking-wide text-text-tertiary">{order.status}</div>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</section>
			{/if}
		</div>
	</main>
</div>

<!-- Dialogs -->
{#if dialog.kind === "benefit-create" || dialog.kind === "benefit-edit"}
	<Dialog
		open
		onClose={closeDialog}
		title={dialog.kind === "benefit-edit" ? "Edit benefit" : "New benefit"}
		maxWidth="520px"
	>
		<CommerceBenefitEditor
			benefit={dialog.kind === "benefit-edit" ? dialog.benefit : null}
			busy={benefitSaving}
			onSubmit={submitBenefit}
			onCancel={() => (dialog = { kind: "none" })}
		/>
	</Dialog>
{:else if dialog.kind === "product-create" || dialog.kind === "product-edit"}
	<Dialog
		open
		onClose={closeDialog}
		title={dialog.kind === "product-edit" ? "Edit product" : "New product"}
		maxWidth="520px"
	>
		<CommerceProductEditor
			product={dialog.kind === "product-edit" ? dialog.product : null}
			busy={productSaving}
			onSubmit={submitProduct}
			onCancel={() => (dialog = { kind: "none" })}
		/>
	</Dialog>
{/if}
