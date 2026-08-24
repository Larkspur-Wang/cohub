import type { Permission } from "./types.js";
import type { AppRecord } from "./apis/apps.js";
import type {
	AppRuntimeCheckoutState,
	AppRuntimeContext,
	AppRuntimeInvocationContext,
} from "./app-runtime.js";
import {
	clearGrantedAppScopes,
	hasGrantedAppScopes,
	setGrantedAppScopes,
} from "./app-grant-cache.js";

/**
 * The subset of an app record the bridge host needs to answer bridge messages.
 * Matches what the iframe host (AppSurface) and the broker page both have on
 * hand after loading the app.
 */
export type AppBridgeCoreApp = Pick<
	AppRecord,
	"id" | "spaceId" | "slug" | "userUuid" | "appScopes" | "allowedViewerScopes"
>;

/**
 * A pending authorize request surfaced to the UI as a consent dialog.
 */
export type AppAuthorizeRequest = {
	requestId: string;
	scopes: Permission[];
	reason?: string;
};

/**
 * A pending purchase request surfaced to the UI as a checkout confirmation.
 */
export type AppPurchaseRequest = {
	requestId: string;
	productKey: string;
	purchaseAttemptId: string;
};

export type AppCheckoutStarted = AppPurchaseRequest & {
	value?: number;
	currency?: string;
};

/**
 * Reactive dialog state managed by the core. The host (Svelte or React)
 * subscribes via {@link AppBridgeCoreConfig.onStateChange} and mirrors these
 * fields into its own reactive primitives.
 */
export type AppBridgeDialogState = {
	authOpen: boolean;
	pendingAuth: AppAuthorizeRequest | null;
	authError: string | null;
	authSaving: boolean;
	purchaseOpen: boolean;
	pendingPurchase: AppPurchaseRequest | null;
	purchaseError: string | null;
	purchaseSaving: boolean;
};

/**
 * Resolves the current user's Cohub API access token. The core uses this to
 * mint app session / authorization tokens via the Cohub API.
 */
export type AppBridgeGetAccessToken = (
	options?: { forceRefresh?: boolean },
) => Promise<string | null>;

/**
 * Resolves the current viewer's user UUID (or null when unauthenticated).
 * Used for ownership checks and silent re-authorization cache lookups.
 */
export type AppBridgeGetViewerUuid = () => Promise<string | null>;

export type AppPromotionAttributionContext = {
	promotionId: string;
	sourceUrl?: string;
	fbp?: string;
	fbc?: string;
};

export type AppBridgeAuthorizationContext = {
	/** The host surface handling this authorization request. */
	surface: "page" | "app" | "background" | "broker";
};

/**
 * Requests the host to start a sign-in flow, redirecting back to the given
 * path afterward. The core calls this when an API request fails due to missing
 * authentication.
 */
export type AppBridgeRequestSignIn = (redirectPath: string) => Promise<void>;

/**
 * Configuration injected by the caller. The core is transport-agnostic: how a
 * reply is delivered back to the app (iframe postMessage vs opener
 * postMessage) and how the current checkout state is read (page URL) are the
 * caller's responsibility, so the same core serves both bridge and broker
 * hosts. Auth dependencies (token resolution, viewer identity, sign-in) are
 * also injected so the core stays free of any framework's store/auth plumbing.
 */
export type AppBridgeCoreConfig = {
	app: AppBridgeCoreApp;
	/** Trusted host context used to decide whether the publisher may authorize silently. */
	authorizationContext?: AppBridgeAuthorizationContext;
	/** Optional snapshot describing what opened this app runtime. */
	invocation?: AppRuntimeInvocationContext;
	/** Reads the latest opening context without recreating the app surface. */
	getInvocation?: () => AppRuntimeInvocationContext | undefined;
	/** Sends an unsolicited event to the app runtime. */
	notify?: (payload: Record<string, unknown>) => void;
	/** @deprecated Use authorizationContext with a background surface. */
	isBackground?: boolean;
	/** Base origin for Cohub API requests (e.g. "https://cohub.live"). */
	apiOrigin: string;
	/** Sends a reply payload back to the app runtime. */
	reply: (requestId: string, payload: Record<string, unknown>) => void;
	/** Reads the current checkout state (typically derived from the page URL). */
	getCheckoutState: () => AppRuntimeCheckoutState;
	/** Resolves the current user's Cohub access token. */
	getAccessToken: AppBridgeGetAccessToken;
	/** Resolves the current viewer's user UUID. */
	getViewerUuid: AppBridgeGetViewerUuid;
	/** Starts a sign-in flow with a post-login redirect path. */
	requestSignIn: AppBridgeRequestSignIn;
	/** Returns optional host-owned promotion attribution for checkout. */
	getPromotionAttribution?: () => AppPromotionAttributionContext | null;
	/** Called when the host displays the purchase confirmation. */
	onPurchaseRequested?: (input: AppPurchaseRequest) => void;
	/** Called immediately before navigating to a usable checkout. */
	onCheckoutStarted?: (input: AppCheckoutStarted) => void;
	/** Called whenever the dialog state changes, for reactive UI binding. */
	onStateChange?: (state: AppBridgeDialogState) => void;
};

export type AppBridgeCore = {
	/** Returns a snapshot of the current dialog state. */
	getState: () => AppBridgeDialogState;
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

function readTokenResponse(value: unknown) {
	if (!value || typeof value !== "object") return null;
	const token = (value as Record<string, unknown>).token;
	return typeof token === "string" && token ? token : null;
}

function clonePermissionScopes(scopes: readonly Permission[] | null | undefined) {
	return Array.from(scopes ?? []).filter(
		(scope): scope is Permission => typeof scope === "string",
	);
}

/**
 * Framework-agnostic app bridge host core — message handling, app session
 * token minting, authorization (with silent re-grant cache), and
 * purchase/checkout flow — without any rendering or reactive primitives.
 *
 * Both the Cohub iframe host (AppSurface, Svelte) and the standalone broker
 * page compose this with their own transport-specific reply and auth
 * dependencies. External hosts (e.g. Neta-Studio in React) can do the same.
 */
export function createAppBridgeCore(
	config: AppBridgeCoreConfig,
): AppBridgeCore {
	const { app, reply, getCheckoutState, getAccessToken, getViewerUuid } =
		config;
	const apiOrigin = config.apiOrigin;
	const authorizationContext =
		config.authorizationContext ??
		(config.isBackground
			? { surface: "background" as const }
			: { surface: "page" as const });
	const onStateChange = config.onStateChange;

	let appToken: string | null = null;
	let activeInvocation: AppRuntimeInvocationContext | undefined;
	let contextChangeVersion = 0;

	async function getContext(): Promise<AppRuntimeContext> {
		const invocation =
			activeInvocation !== undefined
				? activeInvocation
				: config.getInvocation?.() ?? config.invocation;
		const appScopes = clonePermissionScopes(app.appScopes);
		const viewerUuid = await getViewerUuid();
		return {
			app: {
				id: app.id,
				slug: app.slug,
				url: typeof location !== "undefined" ? location.href : "",
			},
			space: { id: app.spaceId },
			viewer: viewerUuid ? { userUuid: viewerUuid } : null,
			...(invocation ? { invocation: { ...invocation } } : {}),
			permissions: {
				scopes: appScopes,
				appScopes,
				viewerScopes: [],
			},
		};
	}

	async function notifyContextChanged(
		invocation?: AppRuntimeInvocationContext,
	) {
		activeInvocation = invocation;
		const version = ++contextChangeVersion;
		if (!config.notify) return;
		const context = await getContext();
		if (version !== contextChangeVersion) return;
		config.notify({
			type: "cohub.app.context.changed",
			context,
		});
	}

	const state: AppBridgeDialogState = {
		authOpen: false,
		pendingAuth: null,
		authError: null,
		authSaving: false,
		purchaseOpen: false,
		pendingPurchase: null,
		purchaseError: null,
		purchaseSaving: false,
	};

	function notify() {
		onStateChange?.({ ...state });
	}

	const pendingPurchaseStorageKey = `cohub-app-purchase:${app.id}`;

	async function isCurrentViewerAppOwner() {
		const viewerUuid = await getViewerUuid();
		return Boolean(viewerUuid && viewerUuid === app.userUuid);
	}

	function allowsOwnerAutoAuthorization() {
		return (
			authorizationContext.surface === "background" ||
			authorizationContext.surface === "app"
		);
	}

	async function ensureBaseToken(forceRefresh = false) {
		if (appToken && !forceRefresh) return appToken;
		const userToken = await getAccessToken({ forceRefresh });
		if (!userToken) {
			await config.requestSignIn(
				typeof location !== "undefined" ? location.pathname : "/",
			);
			return null;
		}
		const response = await fetch(
			`${apiOrigin}/api/apps/${app.id}/session`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${userToken}` },
			},
		);
		if (!response.ok) throw new Error("Failed to create app session.");
		const token = readTokenResponse(await response.json());
		if (!token) throw new Error("Invalid app session response.");
		appToken = token;
		return appToken;
	}

	async function authorize(scopes: Permission[]) {
		const userToken = await getAccessToken();
		if (!userToken) {
			await config.requestSignIn(
				typeof location !== "undefined" ? location.pathname : "/",
			);
			return null;
		}
		const response = await fetch(
			`${apiOrigin}/api/apps/${app.id}/authorize`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ scopes }),
			},
		);
		if (!response.ok)
			throw new Error(
				(await response.json().catch(() => null))?.message ??
					"Authorization failed.",
			);
		const token = readTokenResponse(await response.json());
		if (!token) throw new Error("Invalid app authorization response.");
		appToken = token;
		return appToken;
	}

	function writePendingPurchase(input: {
		orderId: string;
		productKey: string;
	}) {
		if (typeof sessionStorage === "undefined") return;
		try {
			sessionStorage.setItem(
				pendingPurchaseStorageKey,
				JSON.stringify({ ...input, at: Date.now() }),
			);
		} catch {
			// ignore storage failures
		}
	}

	function readPendingPurchase(): {
		orderId: string;
		productKey: string;
		at: number;
	} | null {
		if (typeof sessionStorage === "undefined") return null;
		try {
			const raw = sessionStorage.getItem(pendingPurchaseStorageKey);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as {
				orderId?: unknown;
				productKey?: unknown;
				at?: unknown;
			};
			return typeof parsed.orderId === "string" &&
				typeof parsed.productKey === "string" &&
				typeof parsed.at === "number"
				? {
						orderId: parsed.orderId,
						productKey: parsed.productKey,
						at: parsed.at,
					}
				: null;
		} catch {
			return null;
		}
	}

	function clearPendingPurchase() {
		if (typeof sessionStorage === "undefined") return;
		try {
			sessionStorage.removeItem(pendingPurchaseStorageKey);
		} catch {
			// ignore storage failures
		}
	}

	async function createPurchase(
		productKey: string,
		purchaseAttemptId: string,
	) {
		const userToken = await getAccessToken();
		if (!userToken) {
			await config.requestSignIn(
				typeof location !== "undefined"
					? location.pathname + location.search + location.hash
					: "/",
			);
			return null;
		}
		const promotionAttribution = config.getPromotionAttribution?.() ?? null;
		const response = await fetch(
			`${apiOrigin}/api/apps/${app.id}/commerce/purchase`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					productKey,
					purchaseAttemptId,
					...(promotionAttribution ? { promotionAttribution } : {}),
				}),
			},
		);
		if (!response.ok)
			throw new Error(
				(await response.json().catch(() => null))?.message ??
					"Purchase failed.",
			);
		const json = await response.json();
		return (json as { checkout?: unknown }).checkout ?? null;
	}

	async function handleMessage(event: MessageEvent) {
		const data = event.data as {
			type?: string;
			requestId?: string;
			scopes?: Permission[];
			reason?: string;
			forceRefresh?: boolean;
			productKey?: string;
			purchaseAttemptId?: string;
		};
		if (!data?.requestId) return;
		try {
			if (data.type === "cohub.app.context") {
				reply(data.requestId, {
					type: "cohub.app.context.result",
					context: await getContext(),
				});
			}
			if (data.type === "cohub.app.token") {
				const token = await ensureBaseToken(Boolean(data.forceRefresh));
				reply(data.requestId, { type: "cohub.app.token.result", token });
			}
			if (data.type === "cohub.app.checkout-state") {
				const pending = readPendingPurchase();
				const checkoutState = getCheckoutState();
				const orderId =
					checkoutState.orderId ?? pending?.orderId ?? null;
				if (checkoutState.status && checkoutState.orderId)
					clearPendingPurchase();
				reply(data.requestId, {
					type: "cohub.app.checkout-state.result",
					status: checkoutState.status,
					orderId,
				});
			}
			if (data.type === "cohub.app.purchase") {
				const productKey =
					typeof data.productKey === "string" ? data.productKey.trim() : "";
				if (!productKey) {
					reply(data.requestId, {
						type: "cohub.app.error",
						message: "Product key is required.",
					});
					return;
				}
				const suppliedPurchaseAttemptId =
					typeof data.purchaseAttemptId === "string"
						? data.purchaseAttemptId.trim()
						: "";
				const purchaseAttemptId = suppliedPurchaseAttemptId || data.requestId
					.replace(/[^a-zA-Z0-9_-]/g, "_")
					.slice(0, 128);
				if (!/^[a-zA-Z0-9_-]{1,128}$/.test(purchaseAttemptId)) {
					reply(data.requestId, {
						type: "cohub.app.error",
						message: "Purchase attempt id is invalid.",
					});
					return;
				}
				state.pendingPurchase = {
					requestId: data.requestId,
					productKey,
					purchaseAttemptId,
				};
				state.purchaseError = null;
				state.purchaseOpen = true;
				notify();
				config.onPurchaseRequested?.({ ...state.pendingPurchase });
			}
			if (data.type === "cohub.app.authorize") {
				const allowedViewerScopes = clonePermissionScopes(
					app.allowedViewerScopes,
				);
				const scopes = clonePermissionScopes(data.scopes).filter((scope) =>
					allowedViewerScopes.includes(scope),
				);
				if (scopes.length === 0) {
					reply(data.requestId, {
						type: "cohub.app.error",
						message: "No allowed scopes requested.",
					});
					return;
				}
				if (
					allowsOwnerAutoAuthorization() &&
					(await isCurrentViewerAppOwner())
				) {
					const token = await authorize(scopes);
					reply(data.requestId, {
						type: "cohub.app.authorize.result",
						token,
					});
					return;
				}
				// Returning viewers who previously granted the requested scopes are
				// re-authorized silently with a fresh token — no consent dialog.
				const viewerUuid = await getViewerUuid();
				if (
					viewerUuid &&
					hasGrantedAppScopes(viewerUuid, app.id, scopes)
				) {
					try {
						const token = await authorize(scopes);
						reply(data.requestId, {
							type: "cohub.app.authorize.result",
							token,
						});
						return;
					} catch {
						// Granted scopes may have changed server-side; clear the stale
						// cache and fall back to the consent dialog so the viewer can
						// re-authorize.
						clearGrantedAppScopes(viewerUuid, app.id);
					}
				}
				state.pendingAuth = {
					requestId: data.requestId,
					scopes,
					reason: data.reason,
				};
				state.authError = null;
				state.authOpen = true;
				notify();
			}
		} catch (error) {
			reply(data.requestId, {
				type: "cohub.app.error",
				message: error instanceof Error ? error.message : "Request failed.",
			});
		}
	}

	function cancelAuth() {
		if (state.authSaving) return;
		if (!state.pendingAuth) return;
		reply(state.pendingAuth.requestId, {
			type: "cohub.app.authorize.result",
			token: null,
		});
		state.authOpen = false;
		state.pendingAuth = null;
		state.authError = null;
		state.authSaving = false;
		notify();
	}

	function cancelPurchase() {
		if (state.purchaseSaving) return;
		if (!state.pendingPurchase) return;
		reply(state.pendingPurchase.requestId, {
			type: "cohub.app.purchase.result",
			checkout: null,
		});
		state.purchaseOpen = false;
		state.purchaseError = null;
		state.pendingPurchase = null;
		state.purchaseSaving = false;
		notify();
	}

	async function confirmPurchase() {
		if (!state.pendingPurchase || state.purchaseSaving) return;
		state.purchaseSaving = true;
		state.purchaseError = null;
		notify();
		try {
			const checkout = await createPurchase(
				state.pendingPurchase.productKey,
				state.pendingPurchase.purchaseAttemptId,
			);
			reply(state.pendingPurchase.requestId, {
				type: "cohub.app.purchase.result",
				checkout,
			});
			if (checkout && typeof checkout === "object") {
				const next = checkout as {
					checkoutUrl?: unknown;
					checkoutUsable?: unknown;
					orderId?: unknown;
					productKey?: unknown;
					value?: unknown;
					currency?: unknown;
				};
				if (
					typeof next.orderId === "string" &&
					typeof next.productKey === "string"
				) {
					writePendingPurchase({
						orderId: next.orderId,
						productKey: next.productKey,
					});
				}
				const url = next.checkoutUrl;
				const usable = next.checkoutUsable === true;
				if (usable && typeof url === "string" && url) {
					config.onCheckoutStarted?.({
						...state.pendingPurchase,
						...(typeof next.value === "number" ? { value: next.value } : {}),
						...(typeof next.currency === "string" ? { currency: next.currency } : {}),
					});
					window.location.href = url;
				}
			}
			state.purchaseOpen = false;
			state.pendingPurchase = null;
		} catch (error) {
			state.purchaseError =
				error instanceof Error ? error.message : "Purchase failed.";
		} finally {
			state.purchaseSaving = false;
			notify();
		}
	}

	async function confirmAuth() {
		if (!state.pendingAuth || state.authSaving) return;
		state.authError = null;
		state.authSaving = true;
		notify();
		try {
			const token = await authorize(state.pendingAuth.scopes);
			const viewerUuid = await getViewerUuid();
			setGrantedAppScopes(
				viewerUuid,
				app.id,
				state.pendingAuth.scopes,
			);
			reply(state.pendingAuth.requestId, {
				type: "cohub.app.authorize.result",
				token,
			});
			state.authOpen = false;
			state.pendingAuth = null;
		} catch (error) {
			state.authError =
				error instanceof Error ? error.message : "Authorization failed.";
		} finally {
			state.authSaving = false;
			notify();
		}
	}

	return {
		getState: () => ({ ...state }),
		handleMessage,
		notifyContextChanged,
		confirmAuth,
		cancelAuth,
		confirmPurchase,
		cancelPurchase,
	};
}
