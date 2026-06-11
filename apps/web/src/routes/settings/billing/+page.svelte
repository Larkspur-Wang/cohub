<script lang="ts">
import type {
	BillingCatalog,
	BillingCatalogProduct,
	BillingCreditStatus,
	BillingOpenOverageList,
	BillingOrderList,
	BillingOrderStatus,
	BillingProductBillingInterval,
	BillingSubscriptionHistoryList,
	BillingSubscriptionHistoryStatus,
	BillingUsageRecordList,
} from "@neta-art/cohub";
import {
	AlertCircle,
	ChevronLeft,
	ChevronRight,
	Clock,
	CreditCard,
	Gift,
	Loader2,
	ReceiptText,
	RefreshCw,
	Wallet,
} from "lucide-svelte";
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { ensureAuth } from "$lib/auth";
import { handleUnauthorizedError } from "$lib/auth-redirect";
import { sdk } from "$lib/sdk";

const currentPath = $derived(page.url.pathname);
const currentSearch = $derived(page.url.search);
type BillingTab = "balance" | "plans" | "addons" | "redeem";

let balanceCredit = $state<BillingCreditStatus | null>(null);
let balanceOverages = $state<BillingOpenOverageList | null>(null);
let balanceUsage = $state<BillingUsageRecordList | null>(null);
let billingCatalog = $state<BillingCatalog | null>(null);
let billingOrders = $state<BillingOrderList | null>(null);
let billingSubscriptions = $state<BillingSubscriptionHistoryList | null>(null);
let creditLoading = $state(true);
let overageLoading = $state(true);
let usageLoading = $state(true);
let catalogLoading = $state(true);
let ordersLoading = $state(true);
let subscriptionsLoading = $state(true);
let creditError = $state("");
let overageError = $state("");
let usageError = $state("");
let catalogError = $state("");
let ordersError = $state("");
let subscriptionsError = $state("");
let checkoutError = $state("");
let redemptionError = $state("");
let redemptionSuccess = $state("");
let overagePage = $state(1);
let usagePage = $state(1);
let ordersPage = $state(1);
let subscriptionsPage = $state(1);
let activeBillingTab = $state<BillingTab>("balance");
let redemptionCode = $state("");
let selectedPlanInterval =
	$state<
		Extract<BillingProductBillingInterval, "monthly" | "quarterly" | "yearly">
	>("monthly");
let checkoutBusyKey = $state<string | null>(null);
let billingActionBusyKey = $state<string | null>(null);
let redemptionLoading = $state(false);
let checkoutNow = $state(Date.now());
let creditRequest: Promise<void> | null = null;
let overageRequest: Promise<void> | null = null;
let usageRequest: Promise<void> | null = null;
let catalogRequest: Promise<void> | null = null;
let ordersRequest: Promise<void> | null = null;
let subscriptionsRequest: Promise<void> | null = null;
let checkoutExpiryRefreshRequest: Promise<void> | null = null;
const refreshedExpiredCheckoutKeys = new Set<string>();

const balanceConfigured = $derived(
	billingCatalog?.billing.configured ??
		billingOrders?.billing.configured ??
		billingSubscriptions?.billing.configured ??
		balanceCredit?.billing.configured ??
		balanceOverages?.billing.configured ??
		balanceUsage?.billing.configured ??
		true,
);
const billingStatusKnown = $derived(
	Boolean(
		billingCatalog?.billing ||
			billingOrders?.billing ||
			billingSubscriptions?.billing ||
			balanceCredit?.billing ||
			balanceOverages?.billing ||
			balanceUsage?.billing,
	),
);
const overageTotalPages = $derived(
	Math.max(1, balanceOverages?.pagination.maxPage ?? 1),
);
const usageTotalPages = $derived(
	Math.max(1, balanceUsage?.pagination.maxPage ?? 1),
);
const ordersTotalPages = $derived(
	Math.max(1, billingOrders?.pagination.maxPage ?? 1),
);
const subscriptionsTotalPages = $derived(
	Math.max(1, billingSubscriptions?.pagination.maxPage ?? 1),
);
const anyBalanceLoading = $derived(
	creditLoading || overageLoading || usageLoading,
);
const anyBillingLoading = $derived(
	anyBalanceLoading ||
		catalogLoading ||
		ordersLoading ||
		subscriptionsLoading ||
		redemptionLoading,
);
const routeBillingTab = $derived(
	parseBillingTab(page.url.searchParams.get("tab")),
);
const selectedPlanProducts = $derived.by(() =>
	getPlanProductsForInterval(selectedPlanInterval),
);
const currentSubscription = $derived(
	billingCatalog?.currentSubscriptions.find(
		(subscription) => subscription.status === "active",
	) ??
		billingCatalog?.currentSubscriptions.find(
			(subscription) => subscription.status === "trialing",
		) ??
		null,
);
const defaultPlanProduct = $derived.by(() => {
	const catalog = billingCatalog;
	if (!catalog?.defaultPlanProductKey) return null;
	return (
		catalog.plans.find(
			(product) => product.key === catalog.defaultPlanProductKey,
		) ?? null
	);
});
const pendingCheckoutExpirations = $derived.by(() => {
	const expirations: number[] = [];
	for (const order of billingOrders?.items ?? []) {
		const expiresAt = getPendingCheckoutExpiration(order);
		if (expiresAt !== null) expirations.push(expiresAt);
	}
	for (const subscription of billingSubscriptions?.items ?? []) {
		const expiresAt = getPendingCheckoutExpiration(subscription);
		if (expiresAt !== null) expirations.push(expiresAt);
	}
	return expirations;
});

function formatUsdAmount(value: number): string {
	const sign = value < 0 ? "-" : "";
	const absolute = Math.abs(value);
	return `${sign}$${absolute.toLocaleString("en-US", {
		minimumFractionDigits: 0,
		maximumFractionDigits: 8,
	})}`;
}

function parseBillingTab(value: string | null): BillingTab {
	if (value === "plans" || value === "addons" || value === "redeem")
		return value;
	return "balance";
}

function setBillingTab(tab: BillingTab) {
	activeBillingTab = tab;
	const target = new URL(page.url);
	if (tab === "balance") {
		target.searchParams.delete("tab");
	} else {
		target.searchParams.set("tab", tab);
	}
	void goto(`${target.pathname}${target.search}${target.hash}`, {
		keepFocus: true,
		noScroll: true,
	});
}

$effect(() => {
	activeBillingTab = routeBillingTab;
});

function formatProductPrice(value: number): string {
	return `$${value.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function formatCreditAmount(value: number): string {
	return formatUsdAmount(value * 0.00000001);
}

function getDiscountText(product: BillingCatalogProduct): string | null {
	const discountLabel = product.pricing.discountLabel?.trim();
	if (
		discountLabel &&
		!["none", "no discount", "null"].includes(discountLabel.toLowerCase())
	) {
		return discountLabel;
	}
	if (
		typeof product.pricing.discountRate === "number" &&
		product.pricing.discountRate > 0
	) {
		return `${Math.round(product.pricing.discountRate * 100)}% off`;
	}
	return null;
}

function getProductCreditText(product: BillingCatalogProduct): string | null {
	if (product.display.creditBenefits.length > 0) {
		return product.display.creditBenefits
			.map((benefit) => {
				if (
					benefit.grantKind === "plan_period" &&
					benefit.periodAmount !== benefit.cycleAmount
				) {
					return `${formatUsdAmount(benefit.periodAmountUsd)} per period (${formatUsdAmount(benefit.cycleAmountUsd)} per cycle)`;
				}
				return formatUsdAmount(benefit.periodAmountUsd);
			})
			.join(", ");
	}
	if (
		typeof product.display.creditsAmount === "number" &&
		Number.isFinite(product.display.creditsAmount) &&
		product.display.creditsAmount > 0
	) {
		return formatCreditAmount(product.display.creditsAmount);
	}
	return null;
}

function sortProductsByPrice(products: BillingCatalogProduct[]) {
	return [...products].sort(
		(left, right) => left.pricing.amountMinor - right.pricing.amountMinor,
	);
}

function getPlanProductsForInterval(
	interval: Extract<
		BillingProductBillingInterval,
		"monthly" | "quarterly" | "yearly"
	>,
) {
	if (!billingCatalog) return [];
	const defaultPlan = billingCatalog.defaultPlanProductKey
		? billingCatalog.plans.find(
				(product) => product.key === billingCatalog?.defaultPlanProductKey,
			)
		: null;
	const intervalPlans = sortProductsByPrice(
		billingCatalog.plans.filter((product) => product.interval === interval),
	).filter((product) => product.key !== defaultPlan?.key);
	return defaultPlan ? [defaultPlan, ...intervalPlans] : intervalPlans;
}

function productDescription(product: BillingCatalogProduct): string {
	return product.display.description ?? product.description ?? "";
}

function isCurrentPlanProduct(product: BillingCatalogProduct): boolean {
	if (currentSubscription?.productKey === product.key) return true;
	return !currentSubscription && defaultPlanProduct?.key === product.key;
}

function currentSubscriptionLine(): string {
	if (!currentSubscription) return "";
	const parts = [formatHistoryStatus(currentSubscription.status)];
	if (!currentSubscription.currentPeriodEnd) return parts.join(" - ");
	parts.push(
		currentSubscription.cancelAtPeriodEnd
			? `auto-renew canceled, ends ${formatBillingDate(currentSubscription.currentPeriodEnd)}`
			: `renews ${formatBillingDate(currentSubscription.currentPeriodEnd)}`,
	);
	return parts.join(" - ");
}

function returnUrl() {
	if (typeof window === "undefined") return undefined;
	return new URL("/settings/billing", window.location.origin).toString();
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

function formatHistoryStatus(value: string): string {
	return value
		.split(/[._-]/g)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function formatPeriod(subscription: BillingSubscriptionHistoryStatus): string {
	if (!subscription.currentPeriodStart && !subscription.currentPeriodEnd)
		return "No active period";
	if (!subscription.currentPeriodStart)
		return `Until ${formatBillingDate(subscription.currentPeriodEnd)}`;
	if (!subscription.currentPeriodEnd)
		return `From ${formatBillingDate(subscription.currentPeriodStart)}`;
	return `${formatBillingDate(subscription.currentPeriodStart)} - ${formatBillingDate(subscription.currentPeriodEnd)}`;
}

function getPendingCheckoutExpiration(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
): number | null {
	if (item.status !== "pending_checkout" || !item.checkoutExpiresAt)
		return null;
	const expiresAt = Date.parse(item.checkoutExpiresAt);
	return Number.isNaN(expiresAt) ? null : expiresAt;
}

function getPendingCheckoutRefreshKey(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
): string | null {
	if (item.status !== "pending_checkout" || !item.checkoutExpiresAt)
		return null;
	return `${item.id}:${item.checkoutExpiresAt}`;
}

function formatCheckoutCountdown(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
): string | null {
	const expiresAt = getPendingCheckoutExpiration(item);
	if (expiresAt === null) return null;
	const remainingMs = expiresAt - checkoutNow;
	if (remainingMs <= 0) return "Expired";
	const totalSeconds = Math.ceil(remainingMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function isCheckoutExpired(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
): boolean {
	const expiresAt = getPendingCheckoutExpiration(item);
	return expiresAt !== null && expiresAt <= checkoutNow;
}

function canPayCheckout(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
): boolean {
	return (
		item.actions.canPay &&
		!!item.actions.checkoutUrl &&
		!isCheckoutExpired(item)
	);
}

function historyAmount(value: {
	paidAmountUsd: number;
	amountUsd: number;
}): string {
	return formatProductPrice(
		value.paidAmountUsd > 0 ? value.paidAmountUsd : value.amountUsd,
	);
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

async function loadCreditStatus(options: { force?: boolean } = {}) {
	if (creditRequest) {
		if (!options.force) return creditRequest;
		await creditRequest;
	}
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

async function loadOveragesPage(
	page = overagePage,
	options: { force?: boolean } = {},
) {
	if (overageRequest) {
		if (!options.force) return overageRequest;
		await overageRequest;
	}
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

async function loadUsagePage(
	page = usagePage,
	options: { force?: boolean } = {},
) {
	if (usageRequest) {
		if (!options.force) return usageRequest;
		await usageRequest;
	}
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

async function loadCatalog(options: { force?: boolean } = {}) {
	if (catalogRequest) {
		if (!options.force) return catalogRequest;
		await catalogRequest;
	}
	catalogLoading = true;
	catalogError = "";
	catalogRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const { catalog } = await sdk.billing.getCatalog();
			billingCatalog = catalog;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			catalogError =
				error instanceof Error
					? error.message
					: "Failed to load billing catalog";
			console.error("[billing] Failed to load catalog:", error);
		} finally {
			catalogLoading = false;
			catalogRequest = null;
		}
	})();
	return catalogRequest;
}

async function loadOrdersPage(
	page = ordersPage,
	options: { force?: boolean } = {},
) {
	if (ordersRequest) {
		if (!options.force) return ordersRequest;
		await ordersRequest;
	}
	ordersLoading = true;
	ordersError = "";
	ordersRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const nextPage = Math.max(1, Math.floor(page));
			const { orders } = await sdk.billing.getOrders({
				page: nextPage,
				limit: 10,
			});
			billingOrders = orders;
			ordersPage = orders.page;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			ordersError =
				error instanceof Error ? error.message : "Failed to load orders";
			console.error("[billing] Failed to load orders:", error);
		} finally {
			ordersLoading = false;
			ordersRequest = null;
		}
	})();
	return ordersRequest;
}

async function loadSubscriptionsPage(
	page = subscriptionsPage,
	options: { force?: boolean } = {},
) {
	if (subscriptionsRequest) {
		if (!options.force) return subscriptionsRequest;
		await subscriptionsRequest;
	}
	subscriptionsLoading = true;
	subscriptionsError = "";
	subscriptionsRequest = (async () => {
		if (
			!(await ensureAuth({ redirectPath: `${currentPath}${currentSearch}` }))
		) {
			return;
		}
		try {
			const nextPage = Math.max(1, Math.floor(page));
			const { subscriptions } = await sdk.billing.getSubscriptions({
				page: nextPage,
				limit: 10,
			});
			billingSubscriptions = subscriptions;
			subscriptionsPage = subscriptions.page;
		} catch (error) {
			if (
				await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
			) {
				return;
			}
			subscriptionsError =
				error instanceof Error ? error.message : "Failed to load subscriptions";
			console.error("[billing] Failed to load subscriptions:", error);
		} finally {
			subscriptionsLoading = false;
			subscriptionsRequest = null;
		}
	})();
	return subscriptionsRequest;
}

function refreshBilling() {
	void loadCatalog({ force: true });
	void loadCreditStatus({ force: true });
	void loadOveragesPage(overagePage, { force: true });
	void loadUsagePage(usagePage, { force: true });
	void loadOrdersPage(ordersPage, { force: true });
	void loadSubscriptionsPage(subscriptionsPage, { force: true });
}

async function refreshExpiredPendingCheckouts() {
	if (checkoutExpiryRefreshRequest) return checkoutExpiryRefreshRequest;
	checkoutExpiryRefreshRequest = Promise.all([
		loadCatalog({ force: true }),
		loadOrdersPage(ordersPage, { force: true }),
		loadSubscriptionsPage(subscriptionsPage, { force: true }),
	])
		.then(() => undefined)
		.finally(() => {
			checkoutExpiryRefreshRequest = null;
		});
	return checkoutExpiryRefreshRequest;
}

async function redeemCode(event: SubmitEvent) {
	event.preventDefault();
	const code = redemptionCode.trim();
	if (redemptionLoading || !code || !balanceConfigured || !billingStatusKnown)
		return;
	redemptionLoading = true;
	redemptionError = "";
	redemptionSuccess = "";
	try {
		const { redemption } = await sdk.billing.redeemCode({ code });
		if (!redemption.redeemed) {
			redemptionError = redemption.message ?? "Redemption is not available";
			return;
		}
		redemptionCode = "";
		redemptionSuccess = "Code redeemed successfully";
		await Promise.all([
			loadCatalog({ force: true }),
			loadCreditStatus({ force: true }),
			loadOveragesPage(1, { force: true }),
			loadUsagePage(1, { force: true }),
			loadOrdersPage(1, { force: true }),
			loadSubscriptionsPage(1, { force: true }),
		]);
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		redemptionError =
			error instanceof Error ? error.message : "Failed to redeem code";
	} finally {
		redemptionLoading = false;
	}
}

async function subscribePlan(product: BillingCatalogProduct) {
	if (
		checkoutBusyKey ||
		isCurrentPlanProduct(product) ||
		billingCatalog?.hasActiveSubscription ||
		billingCatalog?.payment.available === false
	) {
		return;
	}
	checkoutBusyKey = product.key;
	checkoutError = "";
	try {
		const { checkout } = await sdk.billing.subscribePlan(product.key, {
			returnUrl: returnUrl(),
		});
		if (checkout.checkoutUsable && checkout.checkoutUrl) {
			window.location.href = checkout.checkoutUrl;
			return;
		}
		checkoutError =
			checkout.payment.reason ??
			checkout.message ??
			"Not available for purchase";
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		checkoutError =
			error instanceof Error ? error.message : "Failed to start subscription";
	} finally {
		checkoutBusyKey = null;
	}
}

async function purchaseAddon(product: BillingCatalogProduct) {
	if (checkoutBusyKey || billingCatalog?.payment.available === false) return;
	checkoutBusyKey = product.key;
	checkoutError = "";
	try {
		const { checkout } = await sdk.billing.purchaseAddon(product.key, {
			returnUrl: returnUrl(),
		});
		if (checkout.checkoutUsable && checkout.checkoutUrl) {
			window.location.href = checkout.checkoutUrl;
			return;
		}
		checkoutError =
			checkout.payment.reason ??
			checkout.message ??
			"Not available for purchase";
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		checkoutError =
			error instanceof Error ? error.message : "Failed to start checkout";
	} finally {
		checkoutBusyKey = null;
	}
}

function payCheckout(
	item: BillingOrderStatus | BillingSubscriptionHistoryStatus,
) {
	if (!canPayCheckout(item) || !item.actions.checkoutUrl) return;
	window.location.href = item.actions.checkoutUrl;
}

async function cancelOrderCheckout(order: BillingOrderStatus) {
	if (!order.actions.canCancelCheckout || billingActionBusyKey) return;
	if (!window.confirm("Cancel this checkout?")) return;
	billingActionBusyKey = `order:${order.id}:cancel-checkout`;
	checkoutError = "";
	try {
		await sdk.billing.cancelOrderCheckout(order.id);
		await Promise.all([
			loadOrdersPage(ordersPage, { force: true }),
			loadCatalog({ force: true }),
			loadCreditStatus({ force: true }),
		]);
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		checkoutError =
			error instanceof Error ? error.message : "Failed to cancel checkout";
	} finally {
		billingActionBusyKey = null;
	}
}

async function cancelSubscriptionCheckout(
	subscription: BillingSubscriptionHistoryStatus,
) {
	if (!subscription.actions.canCancelCheckout || billingActionBusyKey) return;
	if (!window.confirm("Cancel this checkout?")) return;
	billingActionBusyKey = `subscription:${subscription.id}:cancel-checkout`;
	checkoutError = "";
	try {
		await sdk.billing.cancelSubscriptionCheckout(subscription.id);
		await Promise.all([
			loadSubscriptionsPage(subscriptionsPage, { force: true }),
			loadCatalog({ force: true }),
			loadCreditStatus({ force: true }),
		]);
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		checkoutError =
			error instanceof Error ? error.message : "Failed to cancel checkout";
	} finally {
		billingActionBusyKey = null;
	}
}

async function cancelSubscriptionAutoRenew(
	subscription: BillingSubscriptionHistoryStatus,
) {
	if (!subscription.actions.canCancelAutoRenew || billingActionBusyKey) return;
	if (!window.confirm("Cancel auto-renew for this subscription?")) return;
	billingActionBusyKey = `subscription:${subscription.id}:cancel-auto-renew`;
	checkoutError = "";
	try {
		await sdk.billing.cancelSubscriptionAutoRenew(subscription.id);
		await Promise.all([
			loadSubscriptionsPage(subscriptionsPage, { force: true }),
			loadCatalog({ force: true }),
		]);
	} catch (error) {
		if (
			await handleUnauthorizedError(error, `${currentPath}${currentSearch}`)
		) {
			return;
		}
		checkoutError =
			error instanceof Error ? error.message : "Failed to cancel auto-renew";
	} finally {
		billingActionBusyKey = null;
	}
}

function goToOveragePage(page: number) {
	if (overageLoading) return;
	void loadOveragesPage(page);
}

function goToUsagePage(page: number) {
	if (usageLoading) return;
	void loadUsagePage(page);
}

function goToOrdersPage(page: number) {
	if (ordersLoading) return;
	void loadOrdersPage(page);
}

function goToSubscriptionsPage(page: number) {
	if (subscriptionsLoading) return;
	void loadSubscriptionsPage(page);
}

onMount(() => {
	void loadCatalog();
	void loadCreditStatus();
	void loadOveragesPage();
	void loadUsagePage();
	void loadOrdersPage();
	void loadSubscriptionsPage();
	const interval = window.setInterval(() => {
		checkoutNow = Date.now();
	}, 1000);
	return () => window.clearInterval(interval);
});

$effect(() => {
	if (pendingCheckoutExpirations.length === 0) return;
	const nextExpiration = Math.min(...pendingCheckoutExpirations);
	const delay = nextExpiration - checkoutNow;
	if (delay <= 0) {
		const expiredKeys = [
			...(billingOrders?.items ?? []),
			...(billingSubscriptions?.items ?? []),
		]
			.filter((item) => {
				const expiresAt = getPendingCheckoutExpiration(item);
				return expiresAt !== null && expiresAt <= checkoutNow;
			})
			.map(getPendingCheckoutRefreshKey)
			.filter((key): key is string => key !== null)
			.filter((key) => !refreshedExpiredCheckoutKeys.has(key));
		if (expiredKeys.length === 0) return;
		void refreshExpiredPendingCheckouts().then(() => {
			for (const key of expiredKeys) refreshedExpiredCheckoutKeys.add(key);
		});
		return;
	}
	const timeout = window.setTimeout(
		() => {
			checkoutNow = Date.now();
		},
		Math.max(250, delay),
	);
	return () => window.clearTimeout(timeout);
});
</script>

<svelte:head>
	<title>Billing — Cohub</title>
</svelte:head>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
	<div class="flex-1 overflow-y-auto px-6 py-7">
		<section class="max-w-5xl">
			<div class="flex flex-col gap-3 border-b border-border-subtle pb-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 class="text-[18px] font-semibold text-text-primary tracking-tight">Billing</h1>
					<p class="mt-1 max-w-xl text-[13px] leading-5 text-text-tertiary">Balance, subscriptions, and one-time credit packs.</p>
				</div>
				<button type="button" onclick={refreshBilling} disabled={anyBillingLoading} class="inline-flex w-fit items-center gap-1.5 rounded-[5px] border border-border-subtle bg-bg-input px-2.5 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50" title="Refresh billing">
					{#if anyBillingLoading}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<RefreshCw class="h-3.5 w-3.5" />{/if}
					<span>Refresh</span>
				</button>
			</div>

			{#if catalogError}
				<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span class="break-all">{catalogError}</span>
				</div>
			{/if}

			{#if checkoutError}
				<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span class="break-all">{checkoutError}</span>
				</div>
			{/if}

			<section class="grid gap-3 py-5 md:grid-cols-4">
				<div class="rounded-[6px] border border-border-subtle px-3 py-3 md:col-span-2">
					<div class="text-[11px] uppercase tracking-wider text-text-tertiary">Subscription</div>
					<div class="mt-2 truncate text-[14px] font-semibold text-text-primary">
						{#if catalogLoading && !billingCatalog}
							<span class="text-text-tertiary">Loading</span>
						{:else if currentSubscription}
							{currentSubscription.productName ?? currentSubscription.productKey ?? "Active plan"}
						{:else if defaultPlanProduct}
							{defaultPlanProduct.name}
						{:else}
							No active subscription
						{/if}
					</div>
					{#if currentSubscription}
						<div class="mt-1 truncate text-[11px] text-text-tertiary">
							{currentSubscriptionLine()}
						</div>
					{:else if defaultPlanProduct}
						<div class="mt-1 truncate text-[11px] text-text-tertiary">
							Default subscription
						</div>
					{:else if billingCatalog?.payment.available === false}
						<div class="mt-1 truncate text-[11px] text-text-tertiary">
							Payment unavailable: {billingCatalog.payment.reason ?? "No available payment provider"}
						</div>
					{/if}
				</div>
				<div class="rounded-[6px] border border-border-subtle px-3 py-3">
					<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
						<Wallet class="h-3.5 w-3.5" />
						<span>Net Balance</span>
					</div>
					<div class="mt-2 font-mono text-[18px] font-semibold tracking-tight {balanceCredit && balanceCredit.balance.netUsd < 0 ? 'text-error-soft' : 'text-text-primary'}">
						{#if creditLoading && !balanceCredit}
							<span class="text-text-tertiary">Loading</span>
						{:else}
							{formatUsdAmount(balanceCredit?.balance.netUsd ?? 0)}
						{/if}
					</div>
				</div>
				<div class="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
					<div class="rounded-[6px] border border-border-subtle px-3 py-3">
							<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
								<CreditCard class="h-3.5 w-3.5" />
								<span>Available</span>
							</div>
							<div class="mt-2 font-mono text-[13px] font-semibold text-text-primary">
								{#if creditLoading && !balanceCredit}
									<span class="text-text-tertiary">Loading</span>
								{:else}
									{formatUsdAmount(balanceCredit?.balance.availableUsd ?? 0)}
								{/if}
							</div>
						</div>
						<div class="rounded-[6px] border border-border-subtle px-3 py-3">
							<div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-text-tertiary">
								<ReceiptText class="h-3.5 w-3.5" />
								<span>Open Overage</span>
							</div>
							<div class="mt-2 font-mono text-[13px] font-semibold {balanceCredit?.overage.hasOpenOverage ? 'text-error-soft' : 'text-text-primary'}">
								{#if creditLoading && !balanceCredit}
									<span class="text-text-tertiary">Loading</span>
								{:else}
									{formatUsdAmount(balanceCredit?.balance.openOverageUsd ?? 0)}
								{/if}
							</div>
						</div>
					</div>
				</section>

			<div class="border-b border-border-subtle">
				<div class="flex gap-1">
					<button type="button" onclick={() => setBillingTab("balance")} class="border-b-2 px-3 py-2 text-[12px] font-medium transition-colors {activeBillingTab === 'balance' ? 'border-brand text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}">Balance</button>
					<button type="button" onclick={() => setBillingTab("plans")} class="border-b-2 px-3 py-2 text-[12px] font-medium transition-colors {activeBillingTab === 'plans' ? 'border-brand text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}">Plans</button>
					<button type="button" onclick={() => setBillingTab("addons")} class="border-b-2 px-3 py-2 text-[12px] font-medium transition-colors {activeBillingTab === 'addons' ? 'border-brand text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}">Addons</button>
					<button type="button" onclick={() => setBillingTab("redeem")} class="border-b-2 px-3 py-2 text-[12px] font-medium transition-colors {activeBillingTab === 'redeem' ? 'border-brand text-text-primary' : 'border-transparent text-text-tertiary hover:text-text-secondary'}">Redeem</button>
				</div>
			</div>

			{#if activeBillingTab === "plans"}
			<section class="py-5">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 class="text-[14px] font-medium text-text-primary">Plans</h2>
					</div>
					<div class="inline-flex w-fit rounded-[6px] border border-border-subtle bg-bg-subtle p-0.5 text-[12px]">
						<button type="button" onclick={() => (selectedPlanInterval = "monthly")} class="rounded-[5px] px-2.5 py-1.5 transition-colors {selectedPlanInterval === 'monthly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}">Monthly</button>
						<button type="button" onclick={() => (selectedPlanInterval = "quarterly")} class="rounded-[5px] px-2.5 py-1.5 transition-colors {selectedPlanInterval === 'quarterly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}">Quarterly</button>
						<button type="button" onclick={() => (selectedPlanInterval = "yearly")} class="rounded-[5px] px-2.5 py-1.5 transition-colors {selectedPlanInterval === 'yearly' ? 'bg-bg-input text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}">Yearly</button>
					</div>
				</div>

				{#if catalogLoading && !billingCatalog}
					<div class="mt-3 grid gap-3 md:grid-cols-3">
						<div class="h-48 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
						<div class="h-48 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
						<div class="h-48 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					</div>
				{:else if billingCatalog && billingCatalog.plans.length === 0}
					<p class="mt-4 text-[12px] text-text-tertiary">No public subscription plans.</p>
				{:else if selectedPlanProducts.length > 0}
					<div class="mt-3 grid gap-3 md:grid-cols-3">
						{#each selectedPlanProducts as product (product.key)}
							<div class="flex min-h-64 flex-col rounded-[6px] border border-border-subtle px-3 py-3 {product.isDefaultPlan ? 'bg-bg-subtle' : ''}">
								<div class="flex min-w-0 items-center gap-2">
									<h3 class="min-w-0 truncate text-[13px] font-semibold text-text-primary">{product.name}</h3>
									{#if product.isDefaultPlan}
										<span class="shrink-0 rounded-[4px] border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase leading-none tracking-wider text-text-tertiary">Default plan</span>
									{/if}
								</div>
								<div class="mt-3 space-y-1">
									<div class="text-[11px] text-text-tertiary">List price {formatProductPrice(product.pricing.compareAtAmountUsd ?? product.pricing.amountUsd)}</div>
									{#if getDiscountText(product)}
										<div class="text-[11px] text-text-tertiary">Discount {getDiscountText(product)}</div>
									{/if}
									<div class="text-[18px] font-semibold text-text-primary">{formatProductPrice(product.pricing.amountUsd)}</div>
									{#if getProductCreditText(product)}
										<div class="text-[11px] text-text-secondary">Credits included: {getProductCreditText(product)}</div>
									{/if}
								</div>
								<button type="button" onclick={() => subscribePlan(product)} disabled={checkoutBusyKey !== null || isCurrentPlanProduct(product) || billingCatalog?.hasActiveSubscription || billingCatalog?.payment.available === false} class="mt-3 inline-flex h-8 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
									{#if checkoutBusyKey === product.key}
										<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
										<span>Processing</span>
									{:else if isCurrentPlanProduct(product)}
										<span>Current subscription</span>
									{:else if billingCatalog?.hasActiveSubscription || billingCatalog?.payment.available === false}
										<span>Not available</span>
									{:else}
										<span>Subscribe</span>
									{/if}
								</button>
								{#if productDescription(product)}
									<p class="mt-3 text-[12px] leading-5 text-text-secondary">{productDescription(product)}</p>
								{/if}
								{#if product.display.benefits.length}
									<ul class="mt-3 grid gap-1.5 text-[11px] text-text-tertiary">
										{#each product.display.benefits as benefit}
											<li class="flex gap-1.5">
												<span class="mt-1 h-1 w-1 shrink-0 rounded-full bg-text-placeholder"></span>
												<span>{benefit}</span>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-4 text-[12px] text-text-tertiary">No public plans in this billing period.</p>
				{/if}

				<div class="mt-6 border-t border-border-subtle pt-5">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 class="text-[14px] font-medium text-text-primary">Subscriptions</h2>
							<p class="mt-1 text-[11px] text-text-tertiary">{billingSubscriptions?.pagination.totalCount ?? 0} records</p>
						</div>
						<div class="flex items-center gap-2 text-[11px] text-text-tertiary">
							<button type="button" onclick={() => goToSubscriptionsPage(subscriptionsPage - 1)} disabled={subscriptionsLoading || subscriptionsPage <= 1} class="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45" title="Previous subscriptions page">
								<ChevronLeft class="h-3.5 w-3.5" />
							</button>
							<span>Page {subscriptionsPage} of {subscriptionsTotalPages}</span>
							<button type="button" onclick={() => goToSubscriptionsPage(subscriptionsPage + 1)} disabled={subscriptionsLoading || subscriptionsPage >= subscriptionsTotalPages} class="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45" title="Next subscriptions page">
								<ChevronRight class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>

					{#if subscriptionsError}
						<div class="mt-3 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span class="break-all">{subscriptionsError}</span>
						</div>
					{/if}

					{#if subscriptionsLoading && !billingSubscriptions}
						<div class="mt-3 h-32 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					{:else if !balanceConfigured}
						<p class="mt-4 text-[12px] text-text-tertiary">Billing is not available in this environment.</p>
					{:else if !billingSubscriptions || billingSubscriptions.items.length === 0}
						<p class="mt-4 text-[12px] text-text-tertiary">No subscriptions yet.</p>
					{:else}
						<div class="mt-3 divide-y divide-border-subtle rounded-[6px] border border-border-subtle">
							{#each billingSubscriptions.items as subscription (subscription.id)}
								<div class="grid gap-3 px-3 py-3 text-[12px] md:grid-cols-[1.2fr_0.9fr_1.4fr_0.7fr_auto] md:items-center">
									<div class="min-w-0">
										<div class="truncate font-medium text-text-primary">{subscription.productName}</div>
										<div class="mt-0.5 truncate font-mono text-[10px] text-text-placeholder">{shortIdentifier(subscription.id)}</div>
									</div>
									<div class="min-w-0">
										<div class="truncate text-text-secondary">{formatHistoryStatus(subscription.status)}</div>
										{#if subscription.cancelAtPeriodEnd}
											<div class="mt-0.5 text-[11px] text-text-tertiary">Auto-renew canceled</div>
										{/if}
									</div>
									<div class="min-w-0 text-text-tertiary">
										<div class="truncate">{formatPeriod(subscription)}</div>
										{#if formatCheckoutCountdown(subscription)}
											<div class="mt-0.5 flex items-center gap-1.5 text-[11px] {formatCheckoutCountdown(subscription) === 'Expired' ? 'text-error-soft' : 'text-text-tertiary'}">
												<Clock class="h-3 w-3 shrink-0" />
												<span>Checkout {formatCheckoutCountdown(subscription)}</span>
											</div>
										{/if}
									</div>
									<div class="font-mono text-text-primary md:text-right">{historyAmount(subscription)}</div>
									<div class="flex flex-wrap gap-2 md:justify-end">
										{#if canPayCheckout(subscription)}
											<button type="button" onclick={() => payCheckout(subscription)} class="inline-flex h-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-bg-hover">Pay</button>
										{/if}
										{#if subscription.actions.canCancelCheckout}
											<button type="button" onclick={() => cancelSubscriptionCheckout(subscription)} disabled={billingActionBusyKey !== null} class="inline-flex h-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
												{#if billingActionBusyKey === `subscription:${subscription.id}:cancel-checkout`}
													<Loader2 class="mr-1 h-3 w-3 animate-spin" />
												{/if}
												<span>Cancel</span>
											</button>
										{:else if subscription.actions.canCancelAutoRenew}
											<button type="button" onclick={() => cancelSubscriptionAutoRenew(subscription)} disabled={billingActionBusyKey !== null} class="inline-flex h-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
												{#if billingActionBusyKey === `subscription:${subscription.id}:cancel-auto-renew`}
													<Loader2 class="mr-1 h-3 w-3 animate-spin" />
												{/if}
												<span>Cancel auto-renew</span>
											</button>
										{:else}
											<span class="self-center text-[11px] text-text-placeholder">No actions</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>
			{/if}

			{#if activeBillingTab === "addons"}
			<section class="border-t border-border-subtle py-5">
				<h2 class="text-[14px] font-medium text-text-primary">Addons</h2>
				{#if catalogLoading && !billingCatalog}
					<div class="mt-3 grid gap-3 md:grid-cols-3">
						<div class="h-36 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
						<div class="h-36 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
						<div class="h-36 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					</div>
				{:else if !billingCatalog || billingCatalog.addons.length === 0}
					<p class="mt-4 text-[12px] text-text-tertiary">No public one-time products.</p>
				{:else}
					<div class="mt-3 grid gap-3 md:grid-cols-3">
						{#each sortProductsByPrice(billingCatalog.addons) as product (product.key)}
							<div class="flex min-h-44 flex-col rounded-[6px] border border-border-subtle px-3 py-3">
								<h3 class="truncate text-[13px] font-semibold text-text-primary">{product.name}</h3>
								<div class="mt-2 text-[18px] font-semibold text-text-primary">{formatProductPrice(product.pricing.amountUsd)}</div>
								{#if getDiscountText(product)}
									<div class="mt-1 text-[11px] text-text-tertiary">{getDiscountText(product)}</div>
								{/if}
								{#if getProductCreditText(product)}
									<div class="mt-2 text-[11px] text-text-secondary">Credits included: {getProductCreditText(product)}</div>
								{/if}
								{#if productDescription(product)}
									<p class="mt-2 text-[12px] leading-5 text-text-secondary">{productDescription(product)}</p>
								{/if}
								<button type="button" onclick={() => purchaseAddon(product)} disabled={checkoutBusyKey !== null || billingCatalog.payment.available === false} class="mt-auto inline-flex h-8 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
									{#if checkoutBusyKey === product.key}
										<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
										<span>Processing</span>
									{:else if billingCatalog.payment.available === false}
										<span>Not available</span>
									{:else}
										<span>Purchase</span>
									{/if}
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<div class="mt-6 border-t border-border-subtle pt-5">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 class="text-[14px] font-medium text-text-primary">Orders</h2>
							<p class="mt-1 text-[11px] text-text-tertiary">{billingOrders?.pagination.totalCount ?? 0} records</p>
						</div>
						<div class="flex items-center gap-2 text-[11px] text-text-tertiary">
							<button type="button" onclick={() => goToOrdersPage(ordersPage - 1)} disabled={ordersLoading || ordersPage <= 1} class="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45" title="Previous orders page">
								<ChevronLeft class="h-3.5 w-3.5" />
							</button>
							<span>Page {ordersPage} of {ordersTotalPages}</span>
							<button type="button" onclick={() => goToOrdersPage(ordersPage + 1)} disabled={ordersLoading || ordersPage >= ordersTotalPages} class="inline-flex h-7 w-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-45" title="Next orders page">
								<ChevronRight class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>

					{#if ordersError}
						<div class="mt-3 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span class="break-all">{ordersError}</span>
						</div>
					{/if}

					{#if ordersLoading && !billingOrders}
						<div class="mt-3 h-32 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
					{:else if !balanceConfigured}
						<p class="mt-4 text-[12px] text-text-tertiary">Billing is not available in this environment.</p>
					{:else if !billingOrders || billingOrders.items.length === 0}
						<p class="mt-4 text-[12px] text-text-tertiary">No orders yet.</p>
					{:else}
						<div class="mt-3 divide-y divide-border-subtle rounded-[6px] border border-border-subtle">
							{#each billingOrders.items as order (order.id)}
								<div class="grid gap-3 px-3 py-3 text-[12px] md:grid-cols-[1.2fr_0.9fr_1fr_0.8fr_auto] md:items-center">
									<div class="min-w-0">
										<div class="truncate font-medium text-text-primary">{order.productName}</div>
										<div class="mt-0.5 truncate font-mono text-[10px] text-text-placeholder">{shortIdentifier(order.id)}</div>
									</div>
									<div class="min-w-0">
										<div class="truncate text-text-secondary">{formatHistoryStatus(order.status)}</div>
										<div class="mt-0.5 truncate text-[11px] text-text-tertiary">{formatHistoryStatus(order.billingReason)}</div>
									</div>
									<div class="min-w-0 text-text-tertiary">
										<div class="truncate">Created {formatBillingDate(order.createdAt)}</div>
										{#if order.paidAt}
											<div class="mt-0.5 truncate text-[11px]">Paid {formatBillingDate(order.paidAt)}</div>
										{:else if formatCheckoutCountdown(order)}
											<div class="mt-0.5 flex items-center gap-1.5 text-[11px] {formatCheckoutCountdown(order) === 'Expired' ? 'text-error-soft' : 'text-text-tertiary'}">
												<Clock class="h-3 w-3 shrink-0" />
												<span>Checkout {formatCheckoutCountdown(order)}</span>
											</div>
										{/if}
									</div>
									<div class="font-mono text-text-primary md:text-right">{historyAmount(order)}</div>
									<div class="flex flex-wrap gap-2 md:justify-end">
										{#if canPayCheckout(order)}
											<button type="button" onclick={() => payCheckout(order)} class="inline-flex h-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-bg-hover">Pay</button>
										{/if}
										{#if order.actions.canCancelCheckout}
											<button type="button" onclick={() => cancelOrderCheckout(order)} disabled={billingActionBusyKey !== null} class="inline-flex h-7 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-2.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
												{#if billingActionBusyKey === `order:${order.id}:cancel-checkout`}
													<Loader2 class="mr-1 h-3 w-3 animate-spin" />
												{/if}
												<span>Cancel</span>
											</button>
										{:else}
											<span class="self-center text-[11px] text-text-placeholder">No actions</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</section>
			{/if}

			{#if activeBillingTab === "redeem"}
			<section class="border-t border-border-subtle py-5">
				<div class="max-w-xl">
					<h2 class="text-[14px] font-medium text-text-primary">Redeem Code</h2>
					<form class="mt-4 flex flex-col gap-2 sm:flex-row" onsubmit={redeemCode}>
						<label class="sr-only" for="billing-redemption-code">Redemption code</label>
						<input id="billing-redemption-code" bind:value={redemptionCode} autocomplete="off" spellcheck="false" disabled={redemptionLoading || !balanceConfigured || !billingStatusKnown} class="h-9 min-w-0 flex-1 rounded-[5px] border border-border-subtle bg-bg-input px-3 font-mono text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-placeholder focus:border-brand disabled:cursor-not-allowed disabled:opacity-55" placeholder="Redemption code" />
						<button type="submit" disabled={redemptionLoading || !redemptionCode.trim() || !balanceConfigured || !billingStatusKnown} class="inline-flex h-9 items-center justify-center rounded-[5px] border border-border-subtle bg-bg-input px-3 text-[12px] font-medium text-text-primary transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-55">
							{#if redemptionLoading}
								<Loader2 class="mr-1.5 h-3.5 w-3.5 animate-spin" />
								<span>Redeeming</span>
							{:else}
								<Gift class="mr-1.5 h-3.5 w-3.5" />
								<span>Redeem</span>
							{/if}
						</button>
					</form>
					{#if !balanceConfigured}
						<div class="mt-3 text-[12px] text-text-tertiary">Billing is not available in this environment.</div>
					{/if}
					{#if redemptionError}
						<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
							<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span class="break-all">{redemptionError}</span>
						</div>
					{/if}
					{#if redemptionSuccess}
						<div class="mt-4 rounded-md border border-success-soft/30 bg-success-bg p-3 text-[12px] text-success-soft">
							{redemptionSuccess}
						</div>
					{/if}
				</div>
			</section>
			{/if}

			{#if activeBillingTab === "balance"}
			<section class="border-t border-border-subtle py-5">
				<h2 class="text-[14px] font-medium text-text-primary">Balance</h2>
			{#if creditError}
				<div class="mt-4 flex items-start gap-2 rounded-md border border-error-soft/30 bg-error-bg p-3 text-[12px] text-error-soft">
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					<span class="break-all">{creditError}</span>
				</div>
			{/if}

			{#if creditLoading && !balanceCredit}
				<div class="mt-3 h-24 rounded-[6px] bg-bg-hover-strong" aria-hidden="true"></div>
			{:else if !balanceConfigured}
				<div class="py-6 text-[13px] text-text-tertiary">Billing is not available in this environment.</div>
			{:else if balanceCredit}
				<section class="py-5">
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
			{/if}
		</section>
	</div>
</div>
