<script lang="ts">
import type { WorkPublicOwnerRecord, WorkRecord } from "@neta-art/cohub";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { page } from "$app/state";
import { PUBLIC_API_ORIGIN } from "$env/static/public";
import { getAuthToken, signInWithRedirectPath } from "$lib/auth";
import { readWorkCheckoutState } from "$lib/components/work/work-checkout-state";
import { createWorkBridgeHost } from "$lib/features/work/bridge-host.svelte";
import WorkAuthorizeDialog from "$lib/features/work/WorkAuthorizeDialog.svelte";
import WorkPurchaseDialog from "$lib/features/work/WorkPurchaseDialog.svelte";
import { isAllowedWorkOrigin } from "$lib/features/work/work-origin-allowlist";

type BrokerState = "loading" | "need-login" | "ready" | "error";

type WorkDetail = {
	work: Pick<
		WorkRecord,
		| "id"
		| "spaceId"
		| "userUuid"
		| "slug"
		| "workScopes"
		| "allowedViewerScopes"
	>;
	owner: WorkPublicOwnerRecord;
};

const params = $derived(page.url.searchParams);
const workId = $derived(params.get("work") ?? "");
const openerOrigin = $derived(params.get("origin") ?? "");

let phase = $state<BrokerState>("loading");
let errorMessage = $state("");
let workDetail = $state<WorkDetail | null>(null);
let host = $state<ReturnType<typeof createWorkBridgeHost> | null>(null);

// The validated origin of the opener window, confirmed from the actual
// MessageEvent (not just the URL param). Used as targetOrigin for replies.
let validatedOpenerOrigin = $state<string | null>(null);

function fail(msg: string) {
	phase = "error";
	errorMessage = msg;
}

async function loadWorkDetail(token: string): Promise<WorkDetail | null> {
	const response = await fetch(
		`${PUBLIC_API_ORIGIN ?? ""}/api/works/${encodeURIComponent(workId)}/public`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	if (!response.ok) return null;
	const json = (await response.json()) as Partial<WorkDetail>;
	if (!json.work || !json.owner) return null;
	return { work: json.work, owner: json.owner };
}

async function init() {
	if (!workId) {
		fail("Missing work id.");
		return;
	}
	if (typeof window === "undefined" || !window.opener) {
		fail(
			"This page cannot be opened directly. Please access it through a Cohub work.",
		);
		return;
	}

	// 1. Check auth — broker is an OAuth page.
	const token = await getAuthToken();
	if (!token) {
		phase = "need-login";
		return;
	}

	// 2. Load work metadata.
	const detail = await loadWorkDetail(token);
	if (!detail) {
		fail("Work not found or no longer available.");
		return;
	}
	workDetail = detail;

	// 3. Validate opener origin against the allowlist (§8.1 — the real boundary).
	if (!openerOrigin || !isAllowedWorkOrigin(openerOrigin)) {
		fail(
			`This site (${openerOrigin || "unknown"}) is not allowed to request Cohub authorization.`,
		);
		return;
	}

	// 4. Set up the bridge host with a reply that posts back to the opener.
	validatedOpenerOrigin = openerOrigin;
	host = createWorkBridgeHost({
		work: detail.work,
		reply: (requestId, payload) => {
			window.opener?.postMessage(
				{ requestId, ...payload },
				validatedOpenerOrigin ?? openerOrigin,
			);
			// One-shot: close the popup shortly after replying (§7.2), unless
			// the broker is about to navigate to a checkout URL.
			const checkout = (
				payload as {
					checkout?: { checkoutUsable?: unknown; checkoutUrl?: unknown };
				}
			).checkout;
			const willNavigate =
				Boolean(checkout) &&
				checkout?.checkoutUsable === true &&
				typeof checkout?.checkoutUrl === "string";
			if (!willNavigate) {
				setTimeout(() => window.close(), 200);
			}
		},
		getCheckoutState: () => readWorkCheckoutState(page.url),
	});

	phase = "ready";

	// 5. Ready handshake: tell the opener we're ready to receive the request.
	window.opener.postMessage(
		{ type: "cohub.work.broker.ready" },
		validatedOpenerOrigin ?? openerOrigin,
	);
}

function onMessage(event: MessageEvent) {
	if (!window.opener || event.source !== window.opener) return;
	// Validate the real opener origin against the allowlist.
	if (!isAllowedWorkOrigin(event.origin)) return;
	// Use the verified origin for replies.
	validatedOpenerOrigin = event.origin;
	if (!host) return;
	void host.handleMessage(event);
}

async function handleLogin() {
	await signInWithRedirectPath(
		location.pathname + location.search + location.hash,
	);
}

onMount(() => {
	void init();
	window.addEventListener("message", onMessage);
});

onDestroy(() => window.removeEventListener("message", onMessage));
</script>

<svelte:head>
	<title>Authorize — Cohub</title>
</svelte:head>

<div class="broker-page">
	{#if phase === "loading"}
		<div class="broker-center">
			<Loader2 class="h-5 w-5 animate-spin text-text-tertiary" />
			<p class="broker-status">Preparing authorization…</p>
		</div>
	{:else if phase === "need-login"}
		<div class="broker-center">
			<div class="broker-login-icon"><ShieldCheck class="h-5 w-5" /></div>
			<p class="broker-login-title">Sign in to Cohub</p>
			<p class="broker-login-copy">Sign in to continue the authorization flow.</p>
			<button type="button" class="broker-login-btn" onclick={handleLogin}>
				Sign in with Cohub
			</button>
		</div>
	{:else if phase === "error"}
		<div class="broker-center">
			<AlertTriangle class="h-5 w-5 text-error-soft" />
			<p class="broker-error-msg">{errorMessage}</p>
			<p class="broker-error-hint">You can close this window.</p>
		</div>
	{/if}

	{#if host && workDetail}
		{@const h = host}
		{@const detail = workDetail}
		<WorkPurchaseDialog
			open={h.purchaseOpen && !!h.pendingPurchase}
			pending={h.pendingPurchase}
			error={h.purchaseError}
			saving={h.purchaseSaving}
			onConfirm={() => void h.confirmPurchase()}
			onCancel={h.cancelPurchase}
		/>

		<WorkAuthorizeDialog
			open={h.authOpen && !!h.pendingAuth}
			pending={h.pendingAuth}
			error={h.authError}
			saving={h.authSaving}
			workName={detail.work.slug}
			authorName={detail.owner.displayName}
			onConfirm={() => void h.confirmAuth()}
			onCancel={h.cancelAuth}
		/>
	{/if}
</div>

<style>
	.broker-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.broker-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		max-width: 360px;
	}

	.broker-status {
		font-size: 13px;
		color: var(--text-tertiary);
	}

	.broker-login-icon {
		display: inline-flex;
		width: 40px;
		height: 40px;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		background: var(--brand-muted);
		color: var(--brand-muted-fg);
		border: 1px solid var(--brand-border);
	}

	.broker-login-title {
		font-size: 15px;
		font-weight: 650;
		color: var(--text-primary);
	}

	.broker-login-copy {
		font-size: 13px;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.broker-login-btn {
		display: inline-flex;
		height: 36px;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: 8px;
		padding: 0 16px;
		font-size: 13px;
		font-weight: 650;
		border: 1px solid var(--brand);
		background: var(--brand);
		color: var(--brand-contrast-fg);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.broker-login-btn:hover {
		background: var(--brand-hover);
		border-color: var(--brand-hover);
	}

	.broker-error-msg {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.5;
		word-break: break-word;
	}

	.broker-error-hint {
		font-size: 12px;
		color: var(--text-tertiary);
	}
</style>
