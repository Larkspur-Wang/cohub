<script lang="ts">
import type { AppNavigationOpenMessage } from "@cohub/protocol/app-navigation";
import { parseAppRuntimeConfigureRequest } from "@cohub/protocol/app-runtime";
import type { AppComposerChip } from "@cohub/protocol/app-surface";
import type { AppRuntimeShellContext } from "@neta-art/cohub";
import { RefreshCw, X } from "lucide-svelte";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import type { AppSurfaceHost } from "$lib/features/app/surface-host";
import type {
	DesktopLayerManager,
	OverlayGeometry,
} from "./desktop-layer-manager.svelte";
import { resolveOverlayStyle } from "./desktop-layer-manager.svelte";

type Props = {
	manager: DesktopLayerManager;
	shell: AppRuntimeShellContext;
	onComposerChip?: (appId: string, chip: AppComposerChip | null) => void;
	onNavigationOpen?: (message: AppNavigationOpenMessage) => Promise<{
		handled: boolean;
		reason?: "unsupported" | "invalid_target" | "inaccessible" | "timeout";
	}>;
};

const { manager, shell, onComposerChip, onNavigationOpen }: Props = $props();

// Host viewport size for clamping overlay geometry.
let vpWidth = $state(typeof window !== "undefined" ? window.innerWidth : 1280);
let vpHeight = $state(typeof window !== "undefined" ? window.innerHeight : 800);

function onViewportResize() {
	vpWidth = window.innerWidth;
	vpHeight = window.innerHeight;
}

// Per-overlay configure.request listeners. The App posts configure.request
// to window.parent through the normal runtime bridge; we intercept it here
// rather than in AppSurface because overlay geometry is a host concern.
const configureListeners = new Map<string, (e: MessageEvent) => void>();

function attachConfigureListener(appId: string, origin: string) {
	detachConfigureListener(appId);
	const listener = (e: MessageEvent) => {
		if (e.origin !== origin) return;
		const msg = parseAppRuntimeConfigureRequest(e.data);
		if (!msg) return;
		manager.configure(appId, {
			geometry: msg.geometry as OverlayGeometry | undefined,
			inputRegion: msg.inputRegion,
		});
	};
	configureListeners.set(appId, listener);
	window.addEventListener("message", listener);
}

function detachConfigureListener(appId: string) {
	const prev = configureListeners.get(appId);
	if (prev) {
		window.removeEventListener("message", prev);
		configureListeners.delete(appId);
	}
}

function handleSurfaceHost(appId: string, host: AppSurfaceHost | null) {
	if (!host) {
		detachConfigureListener(appId);
	}
	// No origin available here directly; configure listener is attached via
	// AppSurface's frame load event forwarded through onReady instead.
}

function handleComposerChip(appId: string, chip: AppComposerChip | null) {
	manager.setComposerChip(appId, chip);
	onComposerChip?.(appId, chip);
}

function makeNavigationHandler(appId: string) {
	void appId;
	return async (message: AppNavigationOpenMessage) => {
		if (onNavigationOpen) return onNavigationOpen(message);
		return { handled: false as const, reason: "unsupported" as const };
	};
}

$effect(() => {
	return () => {
		// Clean up all configure listeners when the host unmounts.
		for (const appId of configureListeners.keys()) {
			detachConfigureListener(appId);
		}
	};
});
</script>

<svelte:window onresize={onViewportResize} />

<!--
	The desktop layer lives above workspace content (--z-workspace-overlay) and
	below system UI (dialogs, command palette, drag ghost).  It is
	pointer-events: none at the container level; each overlay declares its own
	hit regions via inputRegion.
-->
{#if manager.count > 0}
	<div class="desktop-layer-host" aria-label="Desktop overlays" role="region">
		{#each manager.overlays as overlay (overlay.id)}
			{@const style = resolveOverlayStyle(overlay.geometry, vpWidth, vpHeight)}
			<div class="desktop-overlay" {style}>
				{#if overlay.error}
					<div class="overlay-error" role="status">
						<span class="overlay-error-text" title={overlay.error}>{overlay.error}</span>
						<button
							type="button"
							class="overlay-btn"
							onclick={() => manager.retry(overlay.appId)}
							aria-label="Retry loading {overlay.label}"
						>
							<RefreshCw class="h-3 w-3" />
						</button>
						<button
							type="button"
							class="overlay-btn"
							onclick={() => manager.closeOverlay(overlay.appId)}
							aria-label="Dismiss {overlay.label} overlay"
						>
							<X class="h-3 w-3" />
						</button>
					</div>
				{:else if overlay.detail}
					{#key overlay.mountKey}
						<AppSurface
							mode="overlay"
							app={overlay.detail.app}
							space={overlay.detail.space}
							owner={overlay.detail.owner}
							content={overlay.detail.content ?? null}
							invocation={overlay.invocation}
							{shell}
							onSurfaceHost={(host) => handleSurfaceHost(overlay.appId, host)}
							onComposerChip={(chip) => handleComposerChip(overlay.appId, chip)}
							onCloseRequest={() => manager.closeOverlay(overlay.appId)}
							onNavigationOpen={makeNavigationHandler(overlay.appId)}
						/>
					{/key}
				{/if}

				<!--
					Input-region hit-test layer.
					The overlay wrapper and the iframe inside AppSurface are both
					pointer-events: none.  We place transparent siblings here that
					re-enable pointer events only in the declared regions.
				-->
				{#if overlay.inputRegion === "all"}
					<div class="overlay-input-all" aria-hidden="true"></div>
				{:else if Array.isArray(overlay.inputRegion)}
					{#each overlay.inputRegion as rect, i (i)}
						<div
							class="overlay-input-rect"
							aria-hidden="true"
							style="left:{rect.x}px; top:{rect.y}px; width:{rect.width}px; height:{rect.height}px"
						></div>
					{/each}
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.desktop-layer-host {
		position: absolute;
		inset: 0;
		/* Sits above danmaku and workspace content, below system chrome. */
		z-index: var(--z-workspace-overlay);
		pointer-events: none;
		overflow: hidden;
		contain: strict;
	}

	.desktop-overlay {
		/* geometry computed by resolveOverlayStyle; pointer-events managed
		   by the hit-test siblings below. */
		pointer-events: none;
		background: transparent;
	}

	.overlay-input-all {
		position: absolute;
		inset: 0;
		pointer-events: auto;
	}

	.overlay-input-rect {
		position: absolute;
		pointer-events: auto;
	}

	/* Small floating error pill — does not occupy the overlay's full size. */
	.overlay-error {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border-radius: 6px;
		border: 1px solid var(--border-subtle);
		background: var(--bg-elevated);
		padding: 3px 8px;
		font-size: 11px;
		color: var(--text-secondary);
		pointer-events: auto;
		white-space: nowrap;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--overlay-scrim) 12%, transparent);
	}

	.overlay-error-text {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--error-soft);
	}

	.overlay-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0;
		transition: background-color 100ms ease, color 100ms ease;
	}

	.overlay-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
</style>
