<script lang="ts">
import type { SpacePortStatus } from "@cohub/protocol/ports";
import {
	Check,
	ExternalLink,
	Globe,
	Loader2,
	RefreshCw,
	Rocket,
	X,
} from "lucide-svelte";
import { onDestroy } from "svelte";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";
import type { PreviewCaptureTarget } from "$lib/features/preview-mark";
import PreviewMarkHost from "$lib/features/preview-mark/ui/PreviewMarkHost.svelte";

const {
	port,
	url,
	status = "unknown",
	observedAt,
	focused = false,
	immersive = false,
	onToggleFocus,
	onToggleImmersive,
	onPublish,
	onClose,
}: {
	port: string;
	url: string;
	status?: SpacePortStatus | "unknown";
	observedAt?: number;
	focused?: boolean;
	immersive?: boolean;
	onToggleFocus?: () => void;
	onToggleImmersive?: () => void;
	onPublish?: () => void;
	onClose: () => void;
} = $props();

let frameVersion = $state(0);
let loading = $state(true);
let copied = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let loadTimer: ReturnType<typeof setTimeout> | null = null;
let slowLoad = $state(false);
// Keep the last successfully embedded URL so status/observedAt-only updates
// (or parent re-renders during panel resize) do not remount the iframe.
let committedUrl = $state("");
let iframeEl: HTMLIFrameElement | null = $state(null);
let rootEl: HTMLElement | null = $state(null);
let markOpen = $state(false);

const markTarget = $derived.by((): PreviewCaptureTarget | null => {
	if (!iframeEl || !url) return null;
	return {
		kind: "iframe",
		element: iframeEl,
		source: { kind: "port", port, url },
	};
});

const canEmbed = $derived(status !== "closed" && Boolean(url));
const iframeSrc = $derived.by(() => {
	const base = committedUrl || url;
	if (!base) return "";
	return `${base}${base.includes("?") ? "&" : "?"}__cohub_preview=${frameVersion}`;
});

$effect(() => {
	if (!url) {
		if (committedUrl) committedUrl = "";
		return;
	}
	// Only adopt a new base URL when the public endpoint actually changes.
	if (committedUrl === url) return;
	committedUrl = url;
	loading = true;
	slowLoad = false;
});
const statusLabel = $derived.by(() => {
	if (status === "listening") return "Listening";
	if (status === "closed") return "Closed";
	return "Detecting";
});
const observedLabel = $derived.by(() => {
	if (!observedAt) return "";
	const date = new Date(observedAt);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
});

function refresh() {
	if (!url) return;
	loading = true;
	slowLoad = false;
	frameVersion += 1;
}

async function copyUrl() {
	if (!url) return;
	await navigator.clipboard.writeText(url);
	copied = true;
	if (copiedTimer) clearTimeout(copiedTimer);
	copiedTimer = setTimeout(() => {
		copied = false;
	}, 1500);
}

$effect(() => {
	// Only restart the loading indicator when the embeddable src identity changes.
	const src = iframeSrc;
	const embeddable = canEmbed;
	if (!embeddable || !src) {
		loading = false;
		slowLoad = false;
		return;
	}
	loading = true;
	slowLoad = false;
	if (loadTimer) clearTimeout(loadTimer);
	loadTimer = setTimeout(() => {
		slowLoad = true;
	}, 4500);
	return () => {
		if (loadTimer) clearTimeout(loadTimer);
	};
});

onDestroy(() => {
	if (copiedTimer) clearTimeout(copiedTimer);
	if (loadTimer) clearTimeout(loadTimer);
});
</script>

<div class="port-preview relative flex h-full min-w-0 flex-col bg-bg-content" class:port-preview--immersive={immersive} bind:this={rootEl}>
	<div class="preview-chrome flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3">
		<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-bg-primary text-text-secondary">
			<Globe class="h-3.5 w-3.5" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-2">
				<span class="truncate text-[13px] font-medium text-text-primary">:{port}</span>
				<span class="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none {status === 'listening' ? 'border-success-soft/30 bg-success-bg text-success-soft' : status === 'closed' ? 'border-error-soft/30 bg-error-bg text-error-soft' : 'border-border-subtle bg-bg-primary text-text-tertiary'}">
					<span class="h-1.5 w-1.5 rounded-full {status === 'listening' ? 'bg-success-soft' : status === 'closed' ? 'bg-error-soft' : 'bg-text-placeholder'}"></span>
					{statusLabel}
				</span>
				{#if observedLabel}
					<span class="hidden text-[11px] text-text-tertiary sm:inline">{observedLabel}</span>
				{/if}
			</div>
			<div class="truncate text-[11px] text-text-tertiary" title={url}>{url}</div>
		</div>
		<button type="button" class="preview-icon-btn" onclick={refresh} title="Refresh preview" disabled={!url}>
			<RefreshCw class="h-4 w-4" />
		</button>
		<button type="button" class="preview-icon-btn" onclick={() => void copyUrl()} title="Copy URL" disabled={!url}>
			{#if copied}
				<Check class="h-4 w-4 text-success-soft" />
			{:else}
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
			{/if}
		</button>
		{#if onPublish}
			<button type="button" class="preview-icon-btn" onclick={onPublish} title="Publish work" disabled={!url}>
				<Rocket class="h-4 w-4" />
			</button>
		{/if}
		<a class="preview-icon-btn" href={url} target="_blank" rel="noreferrer" title="Open externally" aria-disabled={!url}>
			<ExternalLink class="h-4 w-4" />
		</a>
		{#if canEmbed}
			<PreviewMarkHost
				bind:open={markOpen}
				target={markTarget}
				surface={rootEl}
				buttonClass="preview-icon-btn"
			/>
		{/if}
		{#if onToggleFocus && onToggleImmersive}
			<PreviewExpandMenu
				{focused}
				{immersive}
				buttonClass="preview-icon-btn"
				iconClass="h-4 w-4"
				{onToggleFocus}
				{onToggleImmersive}
			/>
		{/if}
		<button type="button" class="preview-icon-btn" onclick={onClose} title="Close preview">
			<X class="h-4 w-4" />
		</button>
	</div>

	{#if status === "closed"}
		<div class="flex min-h-0 flex-1 items-center justify-center p-6">
			<div class="max-w-sm text-center">
				<div class="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-bg-surface text-text-tertiary">
					<Globe class="h-5 w-5" />
				</div>
				<div class="mb-1 text-sm font-medium text-text-primary">Port :{port} is closed</div>
				<div class="mb-4 text-xs leading-5 text-text-tertiary">The preview stays here so you can refresh when the dev server comes back.</div>
				<div class="flex items-center justify-center gap-2">
					<button type="button" class="preview-action-btn" onclick={refresh}>Refresh</button>
					<a class="preview-action-btn primary" href={url} target="_blank" rel="noreferrer">Open externally</a>
				</div>
			</div>
		</div>
	{:else if url && iframeSrc}
		<div class="relative min-h-0 flex-1 bg-bg-primary">
			{#if loading}
				<div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-border-subtle bg-bg-content/95 px-3 py-2 text-[11px] text-text-tertiary">
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					<span>{slowLoad ? "Still loading. If the app blocks embedding, open it externally." : "Loading preview…"}</span>
				</div>
			{/if}
			<iframe
				bind:this={iframeEl}
				class="h-full w-full border-0 bg-overlay-control-text"
				src={iframeSrc}
				title={`Port ${port} preview`}
				sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
				referrerpolicy="no-referrer"
				onload={() => {
					loading = false;
					slowLoad = false;
				}}
			></iframe>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-text-tertiary">No public URL for this port.</div>
	{/if}
</div>

<style>
	.port-preview--immersive {
		position: relative;
	}

	.port-preview--immersive > :global(.preview-chrome) {
		position: absolute;
		top: 12px;
		right: 12px;
		left: auto;
		z-index: 25;
		width: auto;
		max-width: min(560px, calc(100% - 24px));
		height: auto;
		min-height: 40px;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
		padding: 6px 8px;
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
		backdrop-filter: blur(14px);
	}

	.port-preview--immersive > :global(.preview-chrome .min-w-0.flex-1) {
		display: none;
	}

	.preview-icon-btn {
		display: inline-flex;
		height: 32px;
		width: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-tertiary);
		text-decoration: none;
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease, transform 120ms ease;
	}
	.preview-icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.preview-icon-btn:active {
		transform: scale(0.96);
	}
	.preview-icon-btn:disabled,
	.preview-icon-btn[aria-disabled="true"] {
		opacity: 0.45;
		pointer-events: none;
	}
	.preview-action-btn {
		display: inline-flex;
		min-height: 32px;
		align-items: center;
		justify-content: center;
		border-radius: 6px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-hover);
		padding: 0 10px;
		color: var(--text-secondary);
		font-size: 12px;
		text-decoration: none;
		cursor: pointer;
	}
	.preview-action-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}
	.preview-action-btn.primary {
		border-color: var(--brand);
		background: var(--brand);
		color: var(--brand-contrast-fg);
	}
</style>
