import type { Permission, WorkRecord } from "@neta-art/cohub";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import { getAuthToken, signInWithRedirectPath } from "$lib/auth";
import { authStore } from "$lib/stores/auth.svelte";
import {
	clearGrantedWorkScopes,
	hasGrantedWorkScopes,
	setGrantedWorkScopes,
} from "$lib/stores/work-grant-cache";
import type { WorkCheckoutState } from "$lib/components/work/work-checkout-state";

/**
 * The subset of a work record the bridge host needs to answer bridge messages.
 * Matches what the iframe host (WorkSurface) and the broker page both have on
 * hand after loading the work.
 */
export type WorkBridgeHostWork = Pick<
	WorkRecord,
	"id" | "spaceId" | "slug" | "userUuid" | "workScopes" | "allowedViewerScopes"
>;

/**
 * A pending authorize request surfaced to the UI as a consent dialog.
 */
export type WorkAuthorizeRequest = {
	requestId: string;
	scopes: Permission[];
	reason?: string;
};

/**
 * A pending purchase request surfaced to the UI as a checkout confirmation.
 */
export type WorkPurchaseRequest = {
	requestId: string;
	productKey: string;
};

/**
 * Configuration injected by the caller. The host is transport-agnostic: how a
 * reply is delivered back to the work (iframe postMessage vs opener
 * postMessage) and how the current checkout state is read (page URL) are the
 * caller's responsibility, so the same host serves both bridge and broker.
 */
export type WorkBridgeHostConfig = {
	work: WorkBridgeHostWork;
	/** True when running as a background chat surface (owner auto-authorizes). */
	isBackground?: boolean;
	/** Sends a reply payload back to the work runtime. */
	reply: (requestId: string, payload: Record<string, unknown>) => void;
	/** Reads the current checkout state (typically derived from the page URL). */
	getCheckoutState: () => WorkCheckoutState;
};

export type WorkBridgeHost = {
	/** Reactive authorize-dialog state. */
	readonly authOpen: boolean;
	readonly pendingAuth: WorkAuthorizeRequest | null;
	readonly authError: string | null;
	readonly authSaving: boolean;
	/** Reactive purchase-dialog state. */
	readonly purchaseOpen: boolean;
	readonly pendingPurchase: WorkPurchaseRequest | null;
	readonly purchaseError: string | null;
	readonly purchaseSaving: boolean;
	/** Processes an inbound bridge message (already source/origin-validated). */
	handleMessage: (event: MessageEvent) => Promise<void>;
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
 * Owns the work bridge host logic — message handling, work session token
 * minting, authorization (with silent re-grant cache), and purchase/checkout
 * flow — without any rendering. UI components bind to its reactive state and
 * call its confirm/cancel handlers. Both the iframe host (WorkSurface) and the
 * standalone broker page compose this with their own transport-specific reply.
 */
export function createWorkBridgeHost(
	config: WorkBridgeHostConfig,
): WorkBridgeHost {
	const { work, reply, getCheckoutState } = config;
	const isBackground = config.isBackground ?? false;

	let workToken = $state<string | null>(null);
	let authOpen = $state(false);
	let purchaseOpen = $state(false);
	let purchaseError = $state<string | null>(null);
	let purchaseSaving = $state(false);
	let pendingPurchase = $state<WorkPurchaseRequest | null>(null);
	let pendingAuth = $state<WorkAuthorizeRequest | null>(null);
	let authError = $state<string | null>(null);
	let authSaving = $state(false);

	const pendingPurchaseStorageKey = `cohub-work-purchase:${work.id}`;

	async function isCurrentViewerWorkOwner() {
		await authStore.ensureLoaded();
		return Boolean(authStore.userUuid && authStore.userUuid === work.userUuid);
	}

	async function ensureBaseToken(forceRefresh = false) {
		if (workToken && !forceRefresh) return workToken;
		const userToken = await getAuthToken({ forceRefresh });
		if (!userToken) {
			await signInWithRedirectPath(location.pathname);
			return null;
		}
		const response = await fetch(
			`${PUBLIC_API_ORIGIN ?? ""}/api/works/${work.id}/session`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${userToken}` },
			},
		);
		if (!response.ok) throw new Error("Failed to create work session.");
		const token = readTokenResponse(await response.json());
		if (!token) throw new Error("Invalid work session response.");
		workToken = token;
		return workToken;
	}

	async function authorize(scopes: Permission[]) {
		const userToken = await getAuthToken();
		if (!userToken) {
			await signInWithRedirectPath(location.pathname);
			return null;
		}
		const response = await fetch(
			`${PUBLIC_API_ORIGIN ?? ""}/api/works/${work.id}/authorize`,
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
		if (!token) throw new Error("Invalid work authorization response.");
		workToken = token;
		return workToken;
	}

	function writePendingPurchase(input: { orderId: string; productKey: string }) {
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

	async function createPurchase(productKey: string) {
		const userToken = await getAuthToken();
		if (!userToken) {
			await signInWithRedirectPath(
				location.pathname + location.search + location.hash,
			);
			return null;
		}
		const response = await fetch(
			`${PUBLIC_API_ORIGIN ?? ""}/api/works/${work.id}/commerce/purchase`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ productKey }),
			},
		);
		if (!response.ok)
			throw new Error(
				(await response.json().catch(() => null))?.message ?? "Purchase failed.",
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
		};
		if (!data?.requestId) return;
		try {
			if (data.type === "cohub.work.context") {
				const workScopes = clonePermissionScopes(work.workScopes);
				reply(data.requestId, {
					type: "cohub.work.context.result",
					context: {
						work: {
							id: work.id,
							slug: work.slug,
							url: location.href,
						},
						space: { id: work.spaceId },
						permissions: {
							scopes: workScopes,
							workScopes,
							viewerScopes: [],
						},
					},
				});
			}
			if (data.type === "cohub.work.token") {
				const token = await ensureBaseToken(Boolean(data.forceRefresh));
				reply(data.requestId, { type: "cohub.work.token.result", token });
			}
			if (data.type === "cohub.work.checkout-state") {
				const pending = readPendingPurchase();
				const state = getCheckoutState();
				const orderId = state.orderId ?? pending?.orderId ?? null;
				if (state.status && state.orderId) clearPendingPurchase();
				reply(data.requestId, {
					type: "cohub.work.checkout-state.result",
					status: state.status,
					orderId,
				});
			}
			if (data.type === "cohub.work.purchase") {
				const productKey =
					typeof data.productKey === "string" ? data.productKey.trim() : "";
				if (!productKey) {
					reply(data.requestId, {
						type: "cohub.work.error",
						message: "Product key is required.",
					});
					return;
				}
				pendingPurchase = { requestId: data.requestId, productKey };
				purchaseError = null;
				purchaseOpen = true;
			}
			if (data.type === "cohub.work.authorize") {
				const allowedViewerScopes = clonePermissionScopes(
					work.allowedViewerScopes,
				);
				const scopes = clonePermissionScopes(data.scopes).filter((scope) =>
					allowedViewerScopes.includes(scope),
				);
				if (scopes.length === 0) {
					reply(data.requestId, {
						type: "cohub.work.error",
						message: "No allowed scopes requested.",
					});
					return;
				}
				if (isBackground && (await isCurrentViewerWorkOwner())) {
					const token = await authorize(scopes);
					reply(data.requestId, {
						type: "cohub.work.authorize.result",
						token,
					});
					return;
				}
				// Returning viewers who previously granted the requested scopes are
				// re-authorized silently with a fresh token — no consent dialog.
				await authStore.ensureLoaded();
				const viewerUuid = authStore.userUuid;
				if (viewerUuid && hasGrantedWorkScopes(viewerUuid, work.id, scopes)) {
					try {
						const token = await authorize(scopes);
						reply(data.requestId, {
							type: "cohub.work.authorize.result",
							token,
						});
						return;
					} catch {
						// Granted scopes may have changed server-side; clear the stale
						// cache and fall back to the consent dialog so the viewer can
						// re-authorize.
						clearGrantedWorkScopes(viewerUuid, work.id);
					}
				}
				pendingAuth = {
					requestId: data.requestId,
					scopes,
					reason: data.reason,
				};
				authError = null;
				authOpen = true;
			}
		} catch (error) {
			reply(data.requestId, {
				type: "cohub.work.error",
				message: error instanceof Error ? error.message : "Request failed.",
			});
		}
	}

	function cancelAuth() {
		if (authSaving) return;
		if (!pendingAuth) return;
		reply(pendingAuth.requestId, {
			type: "cohub.work.authorize.result",
			token: null,
		});
		authOpen = false;
		pendingAuth = null;
		authError = null;
		authSaving = false;
	}

	function cancelPurchase() {
		if (purchaseSaving) return;
		if (!pendingPurchase) return;
		reply(pendingPurchase.requestId, {
			type: "cohub.work.purchase.result",
			checkout: null,
		});
		purchaseOpen = false;
		purchaseError = null;
		pendingPurchase = null;
		purchaseSaving = false;
	}

	async function confirmPurchase() {
		if (!pendingPurchase || purchaseSaving) return;
		purchaseSaving = true;
		purchaseError = null;
		try {
			const checkout = await createPurchase(pendingPurchase.productKey);
			reply(pendingPurchase.requestId, {
				type: "cohub.work.purchase.result",
				checkout,
			});
			if (checkout && typeof checkout === "object") {
				const next = checkout as {
					checkoutUrl?: unknown;
					checkoutUsable?: unknown;
					orderId?: unknown;
					productKey?: unknown;
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
					window.location.href = url;
				}
			}
			purchaseOpen = false;
			pendingPurchase = null;
		} catch (error) {
			purchaseError = error instanceof Error ? error.message : "Purchase failed.";
		} finally {
			purchaseSaving = false;
		}
	}

	async function confirmAuth() {
		if (!pendingAuth || authSaving) return;
		authError = null;
		authSaving = true;
		try {
			const token = await authorize(pendingAuth.scopes);
			await authStore.ensureLoaded();
			setGrantedWorkScopes(authStore.userUuid, work.id, pendingAuth.scopes);
			reply(pendingAuth.requestId, {
				type: "cohub.work.authorize.result",
				token,
			});
			authOpen = false;
			pendingAuth = null;
		} catch (error) {
			authError =
				error instanceof Error ? error.message : "Authorization failed.";
		} finally {
			authSaving = false;
		}
	}

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
		handleMessage,
		confirmAuth,
		cancelAuth,
		confirmPurchase,
		cancelPurchase,
	};
}
