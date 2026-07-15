<script lang="ts">
import type { WorkRecord } from "@neta-art/cohub";
import { onDestroy, untrack } from "svelte";
import * as publicEnv from "$env/static/public";
import MarkdownView from "$lib/components/MarkdownView.svelte";
import { readWorkCheckoutState } from "$lib/components/work/work-checkout-state";
import type { PreviewCaptureTarget } from "$lib/features/preview-mark";
import { createWorkBridgeHost } from "$lib/features/work/bridge-host.svelte";
import WorkAuthorizeDialog from "$lib/features/work/WorkAuthorizeDialog.svelte";
import WorkPurchaseDialog from "$lib/features/work/WorkPurchaseDialog.svelte";
import { sdk } from "$lib/sdk";
import type { WorkspaceFileLinkTarget } from "$lib/workspace-file-links";

let {
	name,
	source,
	type,
	path = null,
	spaceId = null,
	readonly = false,
	work = null,
	markTarget = $bindable(null),
	onOpenFile,
}: {
	name: string;
	source: string;
	type: "markdown" | "html";
	path?: string | null;
	spaceId?: string | null;
	readonly?: boolean;
	/** When set, auto-host work runtime APIs for this published file. */
	work?: WorkRecord | null;
	/** Outbound mark capture target for parent chrome. */
	markTarget?: PreviewCaptureTarget | null;
	onOpenFile?: (target: WorkspaceFileLinkTarget) => void | Promise<void>;
} = $props();

const previewOrigin =
	publicEnv.PUBLIC_PREVIEW_ORIGIN?.replace(/\/+$/, "") ?? "";
let frame: HTMLIFrameElement | null = $state(null);
let previewSrc = $state<string | null>(null);
let previewError = $state<string | null>(null);
let loadToken = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastSrcdocFrame: HTMLIFrameElement | null = null;
let lastSrcdoc = "";

const canUsePreviewOrigin = $derived(
	Boolean(type === "html" && !readonly && previewOrigin && spaceId && path),
);
const previewKey = $derived(
	`${type}:${previewOrigin}:${spaceId ?? ""}:${path ?? ""}`,
);

// Auto-enable work bridge when this HTML file is a published work.
const host = $derived.by(() => {
	if (!work || type !== "html" || !canUsePreviewOrigin) return null;
	return createWorkBridgeHost({
		work,
		reply: (requestId, payload) => {
			frame?.contentWindow?.postMessage(
				{ requestId, ...payload },
				previewOrigin,
			);
		},
		getCheckoutState: () =>
			readWorkCheckoutState(new URL(window.location.href)),
	});
});

function clearRefreshTimer() {
	if (!refreshTimer) return;
	clearTimeout(refreshTimer);
	refreshTimer = null;
}

async function loadPreview(options: { force?: boolean } = {}) {
	const current = ++loadToken;
	clearRefreshTimer();
	previewError = null;
	// Read existing src outside reactive tracking. If loadPreview runs inside
	// $effect and tracks previewSrc, writing it later re-enters the effect and
	// spams createPreviewSession forever.
	const existingSrc = untrack(() => previewSrc);
	// Keep the existing iframe mounted while refreshing the session token so
	// layout resizes / timer renewals do not flash a full reload.
	const keepExistingFrame = Boolean(existingSrc) && !options.force;
	if (!keepExistingFrame) previewSrc = null;
	if (!canUsePreviewOrigin || !spaceId || !path) return;
	try {
		const { token, expiresIn } = await sdk
			.space(spaceId)
			.files.createPreviewSession();
		if (current !== loadToken) return;
		const next = `/s/${encodeURIComponent(spaceId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
		const nextSrc = `${previewOrigin}/__session?token=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
		// Token rotation still needs a navigation, but avoid null→src thrash.
		const currentSrc = untrack(() => previewSrc);
		if (currentSrc !== nextSrc) previewSrc = nextSrc;
		refreshTimer = setTimeout(
			() => void loadPreview(),
			Math.max(30_000, (expiresIn - 60) * 1000),
		);
	} catch (error) {
		if (current !== loadToken) return;
		// Only clear the frame when we never had a successful load.
		if (!keepExistingFrame) previewSrc = null;
		previewError =
			error instanceof Error ? error.message : "Preview failed to load.";
	}
}

function handleFrameMessage(event: MessageEvent) {
	if (
		!host ||
		event.source !== frame?.contentWindow ||
		event.origin !== previewOrigin
	)
		return;
	void host.handleMessage(event);
}

// Publish mark context to parent chrome (button lives in the file header).
$effect(() => {
	if (type !== "html" || !frame || !path) {
		markTarget = null;
		return;
	}
	markTarget = {
		kind: "iframe",
		element: frame,
		source: { kind: "html", path },
	};
});

$effect(() => {
	// Track only the preview identity. loadPreview mutates previewSrc; if that
	// state is tracked here it re-enters forever and spams preview-session.
	previewKey;
	if (type !== "html") return;
	void untrack(() => loadPreview({ force: true }));
	return () => {
		loadToken += 1;
		clearRefreshTimer();
	};
});

// Fallback srcdoc path: only rewrite when source or iframe node actually
// changes so panel resizes never reassign iframe.srcdoc and reload the page.
$effect(() => {
	if (type !== "html" || canUsePreviewOrigin) return;
	const nextSource = source;
	const el = frame;
	if (!el) return;
	if (lastSrcdocFrame === el && lastSrcdoc === nextSource) return;
	lastSrcdocFrame = el;
	lastSrcdoc = nextSource;
	el.srcdoc = nextSource;
});

$effect(() => {
	window.addEventListener("message", handleFrameMessage);
	return () => window.removeEventListener("message", handleFrameMessage);
});

onDestroy(() => {
	markTarget = null;
});
</script>

{#if type === "markdown"}
	<MarkdownView {source} variant="document" baseFilePath={path} {onOpenFile} />
{:else if canUsePreviewOrigin}
	<div class="relative flex h-full min-h-0 flex-col bg-white">
		{#if previewError}
			<div class="flex flex-1 items-center justify-center p-4 text-xs text-error-soft">{previewError}</div>
		{:else if previewSrc}
			<iframe
				bind:this={frame}
				class="min-h-0 flex-1 border-0 bg-white"
				title={`HTML preview: ${name}`}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
				src={previewSrc}
			></iframe>
		{:else}
			<div class="flex flex-1 items-center justify-center p-4 text-xs text-text-tertiary">Loading preview…</div>
		{/if}
	</div>
	{#if host}
		<WorkPurchaseDialog
			open={host.purchaseOpen && !!host.pendingPurchase}
			pending={host.pendingPurchase}
			error={host.purchaseError}
			saving={host.purchaseSaving}
			onConfirm={() => void host.confirmPurchase()}
			onCancel={host.cancelPurchase}
		/>
		<WorkAuthorizeDialog
			open={host.authOpen && !!host.pendingAuth}
			pending={host.pendingAuth}
			error={host.authError}
			saving={host.authSaving}
			workName={work?.slug ?? "Preview"}
			authorName="Cohub"
			onConfirm={() => void host.confirmAuth()}
			onCancel={host.cancelAuth}
		/>
	{/if}
{:else}
	<div class="relative h-full w-full">
		<iframe
			bind:this={frame}
			class="h-full w-full border-0 bg-white"
			title={`HTML preview: ${name}`}
			sandbox="allow-scripts"
		></iframe>
	</div>
{/if}
