<script lang="ts">
import type { AppNavigationOpenMessage } from "@cohub/protocol/app-navigation";
import type { AppRuntimeShellContext } from "@neta-art/cohub";
import { RefreshCw, X } from "lucide-svelte";
import { untrack } from "svelte";
import AppSurface from "$lib/components/app/AppSurface.svelte";
import type { AppSurfaceHost } from "$lib/features/app/surface-host";
import type { AppSurfaceRegistry } from "$lib/features/app/surface-registry";
import {
	inputRegionContains,
	isTrackedInputRegion,
	resolveOverlayRect,
	resolveOverlayStyle,
} from "./desktop-layer-geometry";
import type {
	DesktopLayerManager,
	DesktopOverlay,
} from "./desktop-layer-manager.svelte";

type Props = {
	manager: DesktopLayerManager;
	surfaces: AppSurfaceRegistry;
	shell: AppRuntimeShellContext;
	onNavigationOpen?: (message: AppNavigationOpenMessage) => Promise<{
		handled: boolean;
		reason?: "unsupported" | "invalid_target" | "inaccessible" | "timeout";
	}>;
};

const {
	manager,
	surfaces,
	shell,
	onNavigationOpen = undefined,
}: Props = $props();

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
		surfaces.register({ appId, surface: "overlay" }, (input) =>
			host.call(input),
		),
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

/**
 * Rect regions are hit-tested by the host: the overlay paints everywhere but
 * only takes pointer events while the pointer is inside a declared rect. The
 * flag flips on the move that enters the region, so that event still reaches
 * whatever is underneath — one move later the App owns the pointer. Regions
 * are re-checked against the last pointer position when an App moves them, as
 * moves inside an interactive frame never reach this window.
 */
let layerHost: HTMLDivElement | null = $state(null);
let hotAppIds = $state<ReadonlySet<string>>(new Set());
let pointer: { x: number; y: number } | null = null;

const tracksPointer = $derived(
	manager.overlays.some((overlay) => isTrackedInputRegion(overlay.inputRegion)),
);

function isInteractive(overlay: DesktopOverlay) {
	return overlay.inputRegion === "all" || hotAppIds.has(overlay.appId);
}

function hitTest() {
	if (!pointer || !layerHost) return;
	const origin = layerHost.getBoundingClientRect();
	const next = new Set<string>();
	for (const overlay of manager.overlays) {
		if (!isTrackedInputRegion(overlay.inputRegion)) continue;
		const rect = resolveOverlayRect(overlay.geometry, viewport);
		const x = pointer.x - origin.left - rect.left;
		const y = pointer.y - origin.top - rect.top;
		if (inputRegionContains(overlay.inputRegion, x, y)) next.add(overlay.appId);
	}
	if (!sameSet(next, hotAppIds)) hotAppIds = next;
}

function trackPointer(event: PointerEvent) {
	// Never flip while a button is held: an App's drag would lose the pointer
	// the moment it left the declared rect.
	if (event.buttons !== 0) return;
	pointer = { x: event.clientX, y: event.clientY };
	hitTest();
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>) {
	if (a.size !== b.size) return false;
	for (const item of a) if (!b.has(item)) return false;
	return true;
}

$effect(() => {
	if (!tracksPointer) {
		hotAppIds = new Set();
		return;
	}
	window.addEventListener("pointermove", trackPointer, true);
	return () => window.removeEventListener("pointermove", trackPointer, true);
});

// Every configure.request replaces the overlay list, so reading it is enough
// to re-test the resting pointer against the new regions and geometry.
$effect(() => {
	void manager.overlays;
	void viewport;
	untrack(hitTest);
});
</script>

<svelte:window onresize={syncViewport} />

<!--
	Overlays sit above workspace content (--z-workspace-overlay) and below every
	system surface (toasts, dialogs, command palette, drag ghost). The layer
	itself never takes pointer events and never clips what an App paints; each
	overlay opts in to input through its inputRegion, so the workspace underneath
	stays reachable everywhere the App did not claim.
-->
{#if manager.count > 0}
	<div
		bind:this={layerHost}
		class="desktop-layer-host"
		role="region"
		aria-label="App overlays"
	>
		{#each manager.overlays as overlay (overlay.id)}
			<div
				class="desktop-overlay"
				class:interactive={isInteractive(overlay)}
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
					<div class="overlay-surface">
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
								onComposerChip={(chip) => manager.setComposerChip(overlay.appId, chip)}
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
