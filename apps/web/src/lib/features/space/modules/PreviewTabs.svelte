<script lang="ts">
import { File as FileIcon, Globe, MousePointer2, X } from "lucide-svelte";

type PreviewTab = {
	kind: "file" | "canvas" | "port";
	key: string;
	label: string;
	title: string;
	dirty?: boolean;
	active: boolean;
};

type Props = {
	tabs: PreviewTab[];
	onActivate: (kind: PreviewTab["kind"], key: string) => void;
	onClose: (kind: PreviewTab["kind"], key: string) => void;
};

let { tabs, onActivate, onClose }: Props = $props();

const kindIcon = {
	file: FileIcon,
	canvas: MousePointer2,
	port: Globe,
} as const;
</script>

{#if tabs.length > 1}
	<div class="preview-tabs" role="tablist" aria-label="Open previews">
		{#each tabs as tab (`${tab.kind}:${tab.key}`)}
			{@const Icon = kindIcon[tab.kind]}
			<div class="preview-tab-shell" class:active={tab.active}>
				<button
					type="button"
					class="preview-tab"
					role="tab"
					aria-selected={tab.active}
					title={tab.title}
					onclick={() => onActivate(tab.kind, tab.key)}
				>
					<span class="preview-tab-icon">
						<Icon class="h-3 w-3" />
					</span>
					<span class="truncate">{tab.label}</span>
					{#if tab.dirty}<span class="preview-tab-dot" aria-label="Unsaved changes"></span>{/if}
				</button>
				<button
					type="button"
					class="preview-tab-close"
					aria-label={`Close ${tab.label}`}
					onclick={() => onClose(tab.kind, tab.key)}
				>
					<X class="w-3 h-3" />
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.preview-tabs {
		display: flex;
		gap: 1px;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-bg-surface);
		padding: 0 0.25rem;
		scrollbar-width: thin;
	}

	.preview-tab-shell {
		display: inline-flex;
		min-width: 0;
		max-width: 12rem;
		align-items: center;
		position: relative;
		color: var(--color-text-tertiary);
	}

	.preview-tab-shell:hover {
		color: var(--color-text-secondary);
	}

	.preview-tab-shell.active {
		color: var(--color-text-primary);
	}

	.preview-tab-shell.active::after {
		content: "";
		position: absolute;
		left: 0.25rem;
		right: 0.25rem;
		bottom: 0;
		height: 2px;
		border-radius: 2px 2px 0 0;
		background: var(--color-brand);
	}

	.preview-tab {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4375rem 0.375rem;
		font-size: 0.75rem;
		line-height: 1rem;
		white-space: nowrap;
	}

	.preview-tab-icon {
		display: inline-flex;
		flex: 0 0 auto;
		opacity: 0.6;
	}

	.preview-tab-shell.active .preview-tab-icon {
		opacity: 1;
	}

	.preview-tab-dot {
		height: 0.375rem;
		width: 0.375rem;
		flex: 0 0 auto;
		border-radius: 9999px;
		background: var(--color-warning-soft);
	}

	.preview-tab-close {
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		margin-right: 0.125rem;
		border-radius: 4px;
		opacity: 0;
		color: var(--color-text-tertiary);
		transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
	}

	.preview-tab-shell:hover .preview-tab-close,
	.preview-tab-shell.active .preview-tab-close {
		opacity: 0.55;
	}

	.preview-tab-close:hover {
		background: var(--color-bg-hover);
		opacity: 1 !important;
		color: var(--color-text-secondary);
	}
</style>
