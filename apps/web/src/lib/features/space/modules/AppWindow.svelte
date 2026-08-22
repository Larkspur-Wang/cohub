<script lang="ts">
import type { AppComposerChip } from "@cohub/protocol/app-surface";
import { ExternalLink, Loader2, RefreshCw } from "lucide-svelte";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import CenteredLoading from "$lib/components/CenteredLoading.svelte";
import type { AppSurfaceHost } from "$lib/features/app/surface-host";
import type { InlineAppPreview } from "./app-window-controller.svelte";
import MobileWindowTabsChrome from "./MobileWindowTabsChrome.svelte";
import WindowFloatChrome from "./WindowFloatChrome.svelte";
import type { Window } from "./windows";

type Props = {
	preview: InlineAppPreview;
	windows: Window[];
	immersive: boolean;
	isMobile: boolean;
	treeVisible?: boolean;
	onToggleTree?: () => void;
	onToggleImmersive: () => void | Promise<void>;
	onActivateWindow: (kind: Window["kind"], key: string) => void;
	onCloseWindow: (kind: Window["kind"], key: string) => void;
	onRetry: (appId: string) => void;
	onRegisterSurface: (appId: string, host: AppSurfaceHost | null) => void;
	onComposerChip: (appId: string, chip: AppComposerChip | null) => void;
};

const {
	preview,
	windows,
	immersive,
	isMobile,
	treeVisible = true,
	onToggleTree,
	onToggleImmersive,
	onActivateWindow,
	onCloseWindow,
	onRetry,
	onRegisterSurface,
	onComposerChip,
}: Props = $props();

const detail = $derived(preview.detail);
const publicUrl = $derived(detail?.publicUrl ?? null);

/**
 * The app id of the surface that last registered.
 *
 * The surface reports `null` from its unmount cleanup, and that cleanup runs
 * while this panel is itself being destroyed: closing the last app tab clears
 * `preview` in the same update. Reading the prop there faults on a gone preview
 * and aborts the teardown half-done, which is what left the next open with a
 * blank stage. Keep the id in a plain local so unregistering never reaches back
 * into reactive state. It is deliberately not cleared on unregister — a remount
 * may mount the replacement before the outgoing surface reports, and the id is
 * the same app either way.
 */
let surfaceWorkId: string | null = null;

function handleSurfaceHost(host: AppSurfaceHost | null) {
	if (host) surfaceWorkId = preview.appId;
	if (surfaceWorkId) onRegisterSurface(surfaceWorkId, host);
}

function handleComposerChip(chip: AppComposerChip | null) {
	if (surfaceWorkId) onComposerChip(surfaceWorkId, chip);
}
const launchState = $derived({
	search: preview.launch?.search ?? "",
	hash: preview.launch?.hash ?? "",
});
const isDisabled = $derived(detail?.app.status === "disabled");
</script>

{#snippet WorkActions()}
	<button
		type="button"
		class="preview-icon-btn"
		title="Reload app"
		aria-label="Reload app"
		onclick={() => onRetry(preview.appId)}
	>
		<RefreshCw class="h-4 w-4" />
	</button>
	{#if publicUrl}
		<a
			class="preview-icon-btn"
			href={publicUrl}
			target="_blank"
			rel="noopener"
			title="Open in a new tab"
			aria-label="Open in a new tab"
		>
			<ExternalLink class="h-4 w-4" />
		</a>
	{/if}
{/snippet}

<div class="flex h-full min-w-0 flex-col bg-bg-content" class:preview-stage--immersive={immersive}>
	{#if isMobile}
		<MobileWindowTabsChrome
			tabs={windows}
			onActivate={onActivateWindow}
			onClose={onCloseWindow}
		/>
	{:else if immersive}
		<WindowFloatChrome
			tabs={windows}
			filesVisible={treeVisible}
			onActivate={onActivateWindow}
			onClose={onCloseWindow}
			onToggleFiles={onToggleTree}
			onExit={onToggleImmersive}
		>
			{#snippet context()}{@render WorkActions()}{/snippet}
		</WindowFloatChrome>
	{/if}

	<div class="relative min-h-0 flex-1" data-drawer-swipe-ignore>
		{#if preview.error}
			<div class="flex h-full items-center justify-center p-6">
				<div class="max-w-sm text-center">
					<div class="mb-1 text-sm font-medium text-text-primary">App unavailable</div>
					<div class="mb-4 text-xs leading-5 text-text-tertiary">{preview.error}</div>
					<button
						type="button"
						class="inline-flex min-h-8 items-center rounded-[5px] bg-bg-elevated px-3 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
						onclick={() => onRetry(preview.appId)}
					>
						Try again
					</button>
				</div>
			</div>
		{:else if !detail}
			<CenteredLoading label="Loading App…" size="panel" />
		{:else if !detail.content}
			<div class="flex h-full items-center justify-center p-6 text-center text-xs leading-5 text-text-tertiary">
				{isDisabled
					? "This app is disabled. Publish it again to open it."
					: "This app has no published content yet."}
			</div>
		{:else}
			{#key preview.mountKey}
				<AppSurface
					mode="app"
					app={detail.app}
					space={detail.space}
					owner={detail.owner}
					content={detail.content}
					{launchState}
					invocation={preview.invocation ?? undefined}
					onSurfaceHost={handleSurfaceHost}
					onComposerChip={handleComposerChip}
				/>
			{/key}
		{/if}
		{#if preview.loading && detail}
			<div class="pointer-events-none absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-border-subtle bg-bg-content/95 px-2 py-1 text-[11px] text-text-tertiary">
				<Loader2 class="h-3 w-3 animate-spin" />
				<span>Refreshing…</span>
			</div>
		{/if}
		{#if preview.refreshError && detail}
			<div class="absolute bottom-2 left-2 right-2 z-10 flex items-center gap-2 rounded-md border border-error-soft/30 bg-bg-content/95 px-2.5 py-1.5 text-[11px] text-error-soft shadow-sm">
				<span class="min-w-0 flex-1 truncate">{preview.refreshError}</span>
				<button
					type="button"
					class="shrink-0 text-text-secondary underline underline-offset-2 hover:text-text-primary"
					onclick={() => onRetry(preview.appId)}
				>
					Retry
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
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
		transition: background-color 120ms ease, color 120ms ease;
	}

	.preview-icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
</style>
