<script lang="ts">
import type { SpaceRuntimeSystemBar } from "@cohub/protocol";
import type { SpaceRecord } from "@neta-art/cohub";
import { RotateCcw } from "lucide-svelte";
import SpaceAvatar from "$lib/components/SpaceAvatar.svelte";

type Props = {
	space: SpaceRecord | null;
	spaceId: string;
	config?: SpaceRuntimeSystemBar;
	immersive?: boolean;
	canEditLayout?: boolean;
	onDefaultMode?: () => void;
};

let {
	space,
	spaceId,
	config,
	immersive = false,
	canEditLayout = false,
	onDefaultMode,
}: Props = $props();
const systemBar = $derived(config ?? {});
const content = $derived(systemBar.content ?? {});
const visible = $derived(
	immersive || systemBar.visibility === "always" || !systemBar.visibility,
);
const placement = $derived(systemBar.placement ?? "floating");
const position = $derived(systemBar.position ?? "top-right");
const showBrand = $derived(content.brand !== false);
const showSpace = $derived(content.spaceProfile !== false);
const showDefault = $derived(
	Boolean(canEditLayout && content.defaultLayout !== false),
);
const spaceName = $derived(space?.name || space?.title || spaceId);
const rootClass = $derived.by(() => {
	const base = "cohub-system-bar";
	if (placement !== "floating") return `${base} ${base}--${placement}`;
	return `${base} ${base}--floating ${base}--${position}`;
});
</script>

{#if visible}
	<div class={rootClass} role="navigation" aria-label="Cohub system bar">
		{#if showBrand}
			<div class="cohub-system-bar__brand" aria-label="Cohub">
				<span class="cohub-system-bar__mark">C</span>
				<span class="hidden sm:inline">Cohub</span>
			</div>
		{/if}
		{#if showSpace}
			<div class="cohub-system-bar__space" title={spaceName}>
				<SpaceAvatar name={spaceName} profile={space?.publicProfile} size="xs" />
				<span class="hidden max-w-40 truncate md:inline">{spaceName}</span>
			</div>
		{/if}
		{#if showDefault}
			<button type="button" class="cohub-system-bar__action" onclick={() => onDefaultMode?.()} title="Default layout">
				<RotateCcw class="h-3.5 w-3.5" />
				<span class="hidden lg:inline">Default</span>
			</button>
		{/if}
	</div>
{/if}

<style>
	.cohub-system-bar {
		position: absolute;
		z-index: 45;
		display: flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--border-subtle);
		background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
		color: var(--text-secondary);
		box-shadow: 0 14px 40px color-mix(in srgb, var(--overlay-scrim-strong) 18%, transparent);
		backdrop-filter: blur(10px);
	}
	.cohub-system-bar--floating {
		border-radius: 999px;
		padding: 4px;
	}
	.cohub-system-bar--top-left { left: 12px; top: 12px; }
	.cohub-system-bar--top-right { right: 12px; top: 12px; }
	.cohub-system-bar--bottom-left { left: 12px; bottom: 12px; }
	.cohub-system-bar--bottom-right { right: 12px; bottom: 12px; }
	.cohub-system-bar--top,
	.cohub-system-bar--bottom {
		left: 12px;
		right: 12px;
		justify-content: center;
		border-radius: 10px;
		padding: 4px;
	}
	.cohub-system-bar--top { top: 12px; }
	.cohub-system-bar--bottom { bottom: 12px; }
	.cohub-system-bar--left,
	.cohub-system-bar--right {
		top: 12px;
		bottom: 12px;
		flex-direction: column;
		border-radius: 10px;
		padding: 4px;
	}
	.cohub-system-bar--left { left: 12px; }
	.cohub-system-bar--right { right: 12px; }
	.cohub-system-bar__brand,
	.cohub-system-bar__space,
	.cohub-system-bar__action {
		display: inline-flex;
		min-height: 28px;
		align-items: center;
		gap: 6px;
		border-radius: 999px;
		padding: 0 9px;
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
	}
	.cohub-system-bar__mark {
		display: inline-flex;
		height: 18px;
		width: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 5px;
		background: var(--brand);
		color: var(--brand-contrast-fg);
		font-size: 11px;
		font-weight: 700;
	}
	.cohub-system-bar__action {
		color: var(--text-tertiary);
		transition: color 120ms ease, background 120ms ease;
	}
	.cohub-system-bar__action:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	@media (max-width: 767px) {
		.cohub-system-bar,
		.cohub-system-bar--left,
		.cohub-system-bar--right,
		.cohub-system-bar--top,
		.cohub-system-bar--bottom {
			left: 50%;
			right: auto;
			top: auto;
			bottom: 10px;
			transform: translateX(-50%);
			flex-direction: row;
			border-radius: 999px;
		}
	}
</style>
