<script lang="ts">
import type { AppNavigationOpenMessage } from "@cohub/protocol/app-navigation";
import type { AppRuntimeShellContext } from "@neta-art/cohub";
import { RefreshCw, X } from "lucide-svelte";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import type { AppSurfaceHost } from "$lib/features/app/surface-host";
import type { AppSurfaceRegistry } from "$lib/features/app/surface-registry";
import {
	resolveOverlayInputClip,
	resolveOverlayStyle,
} from "./desktop-layer-geometry";
import type { DesktopLayerManager } from "./desktop-layer-manager.svelte";

type Props = {
	manager: DesktopLayerManager;
	surfaces: AppSurfaceRegistry;
	shell: AppRuntimeShellContext;
	onNavigationOpen?: (message: AppNavigationOpenMessage) => Promise<{
		handled: boolean;
		reason?: "unsupported" | "invalid_target" | "inaccessible" | "timeout";
	}>;
};

const { manager, surfaces, shell, onNavigationOpen = undefined }: Props =
	$props();

/**
 * Each surface hands its host up on mount and `null` on unmount. Disposers are
 * kept here so a remount never leaves a stale invoker pointing at a detached
 * frame — the same contract AppWindow follows.
 */
const surfaceDisposers = new Map<string, () => void>();

function registerSurface(appId: string, host: AppSurfaceHost | null) {
	surfaceDisposers.get(appId)?.();
	surfaceDisposers.delete(appId);
	if (!host) return;
	surfaceDisposers.set(
		appId,
		surfaces.register({ appId, surface: "overlay" }, (input) => host.call(input)),
	);
}

/** Host viewport size, used to clamp overlay geometry on-screen. */
let viewport = $state({
	width: typeof window !== "undefined" ? window.innerWidth : 1280,
	height: typeof window !== "undefined" ? window.innerHeight : 800,
});

function syncViewport() {
	viewport = { width: window.innerWidth, height: window.innerHeight };
}
</script>

<svelte:window onresize={syncViewport} />

<!--
	Overlays sit above workspace content (--z-workspace-overlay) and below every
	system surface (toasts, dialogs, command palette, drag ghost). The layer
	itself never takes pointer events; each overlay opts in through its
	inputRegion, applied as a clip-path so hit-testing matches what the App
	declared while the workspace underneath stays reachable everywhere else.
-->
{#if manager.count > 0}
	<div class="desktop-layer-host" role="region" aria-label="App overlays">
		{#each manager.overlays as overlay (overlay.id)}
			<div
				class="desktop-overlay"
				class:interactive={overlay.inputRegion !== "none"}
				style={resolveOverlayStyle(overlay.geometry, viewport)}
			>
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
							aria-label="Dismiss {overlay.label}"
						>
							<X class="h-3 w-3" />
						</button>
					</div>
				{:else if overlay.detail}
					<div class="overlay-surface" style={resolveOverlayInputClip(overlay.inputRegion)}>
						{#key overlay.mountKey}
							<AppSurface
								mode="overlay"
								app={overlay.detail.app}
								space={overlay.detail.space}
								owner={overlay.detail.owner}
								content={overlay.detail.content ?? null}
								invocation={overlay.invocation}
								{shell}
								onSurfaceHost={(host) => registerSurface(overlay.appId, host)}
								onCloseRequest={() => manager.closeOverlay(overlay.appId)}
								onConfigureRequest={(request) => manager.configure(overlay.appId, request)}
								{onNavigationOpen}
							/>
						{/key}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.desktop-layer-host {
		position: absolute;
		inset: 0;
		z-index: var(--z-workspace-overlay);
		overflow: hidden;
		pointer-events: none;
	}

	.desktop-overlay {
		position: absolute;
		pointer-events: none;
	}

	.overlay-surface {
		width: 100%;
		height: 100%;
	}

	/* clip-path limits both painting and hit-testing to the declared region. */
	.desktop-overlay.interactive .overlay-surface {
		pointer-events: auto;
	}

	.overlay-error {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-elevated);
		padding: 3px 8px;
		font-size: 11px;
		color: var(--text-secondary);
		white-space: nowrap;
		pointer-events: auto;
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
		width: 20px;
		height: 20px;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background-color 100ms ease, color 100ms ease;
	}

	.overlay-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
</style>
