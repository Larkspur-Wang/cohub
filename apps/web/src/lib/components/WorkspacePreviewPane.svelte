<script lang="ts">
const {
	width = 480,
	ariaLabel = "Workspace preview",
	onResizeStart,
	desktopOnly = false,
	immersive = false,
	children,
}: {
	width?: number;
	ariaLabel?: string;
	onResizeStart?: (event: PointerEvent) => void;
	desktopOnly?: boolean;
	immersive?: boolean;
	children: import("svelte").Snippet;
} = $props();
</script>

<section
	class="workspace-preview-pane min-w-0 flex-col border-border-subtle bg-bg-content {desktopOnly ? 'hidden lg:flex' : 'flex'}"
	class:workspace-preview-pane--immersive={immersive}
	style={`--workspace-preview-width: ${width}px`}
	aria-label={ariaLabel}
>
	<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
		{@render children()}
	</div>
	{#if onResizeStart && !immersive}
		<button
			type="button"
			class="preview-resize-handle hidden lg:block"
			aria-label="Resize preview panel"
			title="Resize preview panel"
			onpointerdown={onResizeStart}
		></button>
	{/if}
</section>

<style>
	.workspace-preview-pane {
		position: fixed;
		inset: 0;
		z-index: 50;
		width: 100%;
		height: 100%;
	}

	@media (min-width: 960px) {
		.workspace-preview-pane {
			position: relative;
			z-index: auto;
			width: var(--workspace-preview-width);
			flex-shrink: 0;
			border-left-width: 1px;
		}

		.workspace-preview-pane--immersive {
			position: absolute;
			inset: 0;
			z-index: 0;
			width: 100%;
			height: 100%;
			border-left-width: 0;
		}
	}

	.preview-resize-handle {
		position: absolute;
		top: 0;
		left: -4px;
		width: 8px;
		height: 100%;
		cursor: col-resize;
		border: 0;
		padding: 0;
		background: transparent;
		touch-action: none;
		z-index: 10;
	}

	.preview-resize-handle::after {
		content: "";
		position: absolute;
		left: 3px;
		top: 0;
		width: 2px;
		height: 100%;
		background: transparent;
		transition: background 120ms ease;
	}

	.preview-resize-handle:hover::after,
	:global(body.sidebar-resizing) .preview-resize-handle::after {
		background: var(--border-subtle);
	}
</style>
