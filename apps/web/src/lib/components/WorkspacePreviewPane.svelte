<script lang="ts">
type PreviewPaneMode = "dock" | "fill" | "fullscreen";
type PreviewPaneChrome = "default" | "minimal";

const {
	width = 480,
	ariaLabel = "Workspace preview",
	onResizeStart,
	desktopOnly = false,
	mode = "dock",
	chrome = "default",
	children,
}: {
	width?: number;
	ariaLabel?: string;
	onResizeStart?: (event: PointerEvent) => void;
	desktopOnly?: boolean;
	mode?: PreviewPaneMode;
	chrome?: PreviewPaneChrome;
	children: import("svelte").Snippet;
} = $props();

const isDocked = $derived(mode === "dock");
const isFill = $derived(mode === "fill");
const isFullscreen = $derived(mode === "fullscreen");
</script>

<section
	class:workspace-preview-pane={isDocked}
	class:workspace-preview-pane-fill={isFill}
	class:workspace-preview-pane-fullscreen={isFullscreen}
	class:minimal={chrome === "minimal"}
	class="min-w-0 flex-col border-border-subtle bg-bg-content {desktopOnly ? 'hidden lg:flex' : 'flex'}"
	style={`--workspace-preview-width: ${width}px`}
	aria-label={ariaLabel}
>
	<div class="min-h-0 flex-1">
		{@render children()}
	</div>
	{#if onResizeStart && isDocked}
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

	.workspace-preview-pane-fill,
	.workspace-preview-pane-fullscreen {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		border: 0;
	}

	.workspace-preview-pane-fullscreen {
		position: fixed;
		z-index: 50;
	}

	.workspace-preview-pane-fill.minimal,
	.workspace-preview-pane-fullscreen.minimal {
		background: var(--bg-content);
	}

	@media (min-width: 1024px) {
		.workspace-preview-pane {
			position: relative;
			z-index: auto;
			width: var(--workspace-preview-width);
			flex-shrink: 0;
			border-left-width: 1px;
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
