import {
	type AppAuthorizeRequest,
	type AppBridgeAuthorizationContext,
	type AppBridgeCoreApp,
	type AppPurchaseRequest,
	type AppRuntimeCheckoutState,
	type AppRuntimeInvocationContext,
	createAppBridgeCore,
} from "@neta-art/cohub";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import {
	getAppPromotionCheckoutAttribution,
	reportAppPromotionCheckoutStarted,
	reportAttributedAppPromotionEvent,
} from "$lib/app-promotion";
import { getAuthToken, signInWithRedirectPath } from "$lib/auth";
import { authStore } from "$lib/stores/auth.svelte";

/**
 * The subset of an app record the bridge host needs to answer bridge messages.
 * Matches what the iframe host (AppSurface) and the broker page both have on
 * hand after loading the app.
 */
export type AppBridgeHostApp = AppBridgeCoreApp;

/**
 * A pending authorize request surfaced to the UI as a consent dialog.
 */
/**
 * A pending purchase request surfaced to the UI as a checkout confirmation.
 */
export type {
	AppAuthorizeRequest,
	AppPurchaseRequest,
} from "@neta-art/cohub";

/**
 * Configuration injected by the caller. The host is transport-agnostic: how a
 * reply is delivered back to the app (iframe postMessage vs opener
 * postMessage) and how the current checkout state is read (page URL) are the
 * caller's responsibility, so the same host serves both bridge and broker.
 */
export type AppBridgeHostConfig = {
	app: AppBridgeHostApp;
	authorizationContext?: AppBridgeAuthorizationContext;
	invocation?: AppRuntimeInvocationContext;
	/** Reads the latest opening context without recreating the app surface. */
	getInvocation?: () => AppRuntimeInvocationContext | undefined;
	/** Sends an unsolicited event to the app runtime. */
	notify?: (payload: Record<string, unknown>) => void;
	/** Sends a reply payload back to the app runtime. */
	reply: (requestId: string, payload: Record<string, unknown>) => void;
	/** Reads the current checkout state (typically derived from the page URL). */
	getCheckoutState: () => AppRuntimeCheckoutState;
};

export type AppBridgeHost = {
	/** Reactive authorize-dialog state. */
	readonly authOpen: boolean;
	readonly pendingAuth: AppAuthorizeRequest | null;
	readonly authError: string | null;
	readonly authSaving: boolean;
	/** Reactive purchase-dialog state. */
	readonly purchaseOpen: boolean;
	readonly pendingPurchase: AppPurchaseRequest | null;
	readonly purchaseError: string | null;
	readonly purchaseSaving: boolean;
	/** Processes an inbound bridge message (already source/origin-validated). */
	handleMessage: (event: MessageEvent) => Promise<void>;
	/** Sends the current complete runtime context to the app. */
	notifyContextChanged: (
		invocation?: AppRuntimeInvocationContext,
	) => Promise<void>;
	/** Confirm/cancel handlers for the authorize dialog. */
	confirmAuth: () => Promise<void>;
	cancelAuth: () => void;
	/** Confirm/cancel handlers for the purchase dialog. */
	confirmPurchase: () => Promise<void>;
	cancelPurchase: () => void;
};

/**
 * Svelte 5 reactive wrapper around the framework-agnostic
 * {@link createAppBridgeCore}. Binds the core's dialog state to `$state`
 * runes so Svelte templates can react to authorize/purchase dialog changes,
 * while delegating all message handling, token minting, and API calls to the
 * shared core. Both the iframe host (AppSurface) and the standalone broker
 * page compose this with their own transport-specific reply.
 */
export function createAppBridgeHost(
	config: AppBridgeHostConfig,
): AppBridgeHost {
	let authOpen = $state(false);
	let pendingAuth = $state<AppAuthorizeRequest | null>(null);
	let authError = $state<string | null>(null);
	let authSaving = $state(false);
	let purchaseOpen = $state(false);
	let pendingPurchase = $state<AppPurchaseRequest | null>(null);
	let purchaseError = $state<string | null>(null);
	let purchaseSaving = $state(false);

	const core = createAppBridgeCore({
		app: config.app,
		authorizationContext: config.authorizationContext,
		invocation: config.invocation,
		getInvocation: config.getInvocation,
		notify: config.notify,
		apiOrigin: PUBLIC_API_ORIGIN ?? "",
		reply: config.reply,
		getCheckoutState: config.getCheckoutState,
		getAccessToken: (options) => getAuthToken(options),
		getViewerUuid: async () => {
			await authStore.ensureLoaded();
			return authStore.userUuid;
		},
		requestSignIn: (redirectPath) => signInWithRedirectPath(redirectPath),
		getPromotionAttribution: () =>
			getAppPromotionCheckoutAttribution(config.app.id),
		onPurchaseRequested: (purchase) => {
			void reportAttributedAppPromotionEvent({
				appId: config.app.id,
				eventId: purchase.purchaseAttemptId,
				productKey: purchase.productKey,
			}).catch(() => {
				console.warn(
					"[app-promotions] Failed to report purchase confirmation.",
				);
			});
		},
		onCheckoutStarted: (purchase) => {
			reportAppPromotionCheckoutStarted({
				eventId: purchase.purchaseAttemptId,
				productKey: purchase.productKey,
				value: purchase.value,
				currency: purchase.currency,
			});
		},
		onStateChange: (next) => {
			authOpen = next.authOpen;
			pendingAuth = next.pendingAuth;
			authError = next.authError;
			authSaving = next.authSaving;
			purchaseOpen = next.purchaseOpen;
			pendingPurchase = next.pendingPurchase;
			purchaseError = next.purchaseError;
			purchaseSaving = next.purchaseSaving;
		},
	});

	return {
		get authOpen() {
			return authOpen;
		},
		get pendingAuth() {
			return pendingAuth;
		},
		get authError() {
			return authError;
		},
		get authSaving() {
			return authSaving;
		},
		get purchaseOpen() {
			return purchaseOpen;
		},
		get pendingPurchase() {
			return pendingPurchase;
		},
		get purchaseError() {
			return purchaseError;
		},
		get purchaseSaving() {
			return purchaseSaving;
		},
		handleMessage: core.handleMessage,
		notifyContextChanged: core.notifyContextChanged,
		confirmAuth: core.confirmAuth,
		cancelAuth: core.cancelAuth,
		confirmPurchase: core.confirmPurchase,
		cancelPurchase: core.cancelPurchase,
	};
}
