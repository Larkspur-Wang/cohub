<script lang="ts">
const {
	width = 480,
	ariaLabel = "Workspace preview",
	onResizeStart,
	desktopOnly = false,
	children,
}: {
	width?: number;
	ariaLabel?: string;
	onResizeStart?: (event: PointerEvent) => void;
	desktopOnly?: boolean;
	children: import("svelte").Snippet;
} = $props();
</script>

<section
	class="workspace-preview-pane fixed inset-0 z-50 min-w-0 flex-col border-border-subtle bg-bg-content lg:static lg:z-auto lg:shrink-0 lg:border-l {desktopOnly ? 'hidden lg:flex' : 'flex'}"
	style={`--workspace-preview-width: ${width}px`}
	aria-label={ariaLabel}
>
	<div class="min-h-0 flex-1">
		{@render children()}
	</div>
	{#if onResizeStart}
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
		width: 100%;
		height: 100%;
	}

	@media (min-width: 1024px) {
		.workspace-preview-pane {
			position: relative;
			width: var(--workspace-preview-width);
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
