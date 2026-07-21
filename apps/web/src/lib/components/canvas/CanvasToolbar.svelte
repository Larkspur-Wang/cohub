<script lang="ts">
import { MousePointer2, X } from "lucide-svelte";
import PreviewExpandMenu from "$lib/components/PreviewExpandMenu.svelte";

const {
	title,
	dirty,
	saving,
	focused = false,
	immersive = false,
	onToggleFocus,
	onToggleImmersive,
	onClose,
}: {
	title: string;
	dirty: boolean;
	saving: boolean;
	focused?: boolean;
	immersive?: boolean;
	onToggleFocus?: () => void;
	onToggleImmersive?: () => void;
	onClose: () => void;
} = $props();

const status = $derived(saving ? "Syncing" : dirty ? "Pending" : "Synced");
</script>

<div
	class="preview-chrome flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface px-3"
	class:preview-chrome--immersive={immersive}
>
	<div class="preview-chrome-title flex min-w-0 flex-1 items-center gap-2">
		<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-brand-border bg-brand-bg text-brand-muted-fg">
			<MousePointer2 class="h-3.5 w-3.5" />
		</div>
		<div class="min-w-0">
			<div class="truncate text-[12px] font-medium text-text-primary">{title}</div>
			<div class="text-[10px] uppercase tracking-[0.12em] text-text-tertiary">{status}</div>
		</div>
	</div>

	<div class="flex items-center gap-1">
		{#if onToggleFocus && onToggleImmersive}
			<PreviewExpandMenu
				{focused}
				{immersive}
				buttonClass="canvas-icon"
				iconClass="h-3.5 w-3.5"
				{onToggleFocus}
				{onToggleImmersive}
			/>
		{/if}
		<button type="button" class="canvas-icon" onclick={onClose} title="Close canvas" aria-label="Close canvas">
			<X class="h-3.5 w-3.5" />
		</button>
	</div>
</div>

<style>
	.preview-chrome--immersive {
		position: absolute;
		top: 12px;
		right: 12px;
		left: auto;
		z-index: 25;
		width: auto;
		max-width: min(640px, calc(100% - 24px));
		height: auto;
		min-height: 40px;
		justify-content: flex-end;
		gap: 6px;
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
		padding: 6px 8px;
		box-shadow: 0 12px 28px color-mix(in srgb, var(--overlay-scrim-strong) 16%, transparent);
		backdrop-filter: blur(14px);
	}

	.preview-chrome--immersive .preview-chrome-title {
		display: none;
	}

	.canvas-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid transparent;
		color: var(--text-secondary);
		transition: background-color 100ms ease, color 100ms ease;
	}
	.canvas-icon:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
