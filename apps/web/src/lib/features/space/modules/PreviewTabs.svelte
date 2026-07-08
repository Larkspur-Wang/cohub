<script lang="ts">
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
</script>

{#if tabs.length > 1}
	<div class="preview-tabs" role="tablist" aria-label="Open previews">
		{#each tabs as tab (`${tab.kind}:${tab.key}`)}
			<div class="preview-tab-shell" class:active={tab.active}>
				<button
					type="button"
					class="preview-tab"
					role="tab"
					aria-selected={tab.active}
					title={tab.title}
					onclick={() => onActivate(tab.kind, tab.key)}
				>
					<span class="preview-tab-kind">{tab.kind}</span>
					<span class="truncate">{tab.label}</span>
					{#if tab.dirty}<span class="preview-tab-dot" aria-label="Unsaved changes"></span>{/if}
				</button>
				<button
					type="button"
					class="preview-tab-close"
					aria-label={`Close ${tab.label}`}
					onclick={() => onClose(tab.kind, tab.key)}
				>
					×
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.preview-tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-bg-surface);
		padding: 0.25rem 0.375rem 0;
		scrollbar-width: thin;
	}

	.preview-tab-shell {
		display: inline-flex;
		min-width: 0;
		max-width: 11rem;
		align-items: center;
		border: 1px solid transparent;
		border-bottom: 0;
		border-radius: 0.5rem 0.5rem 0 0;
		color: var(--color-text-tertiary);
	}

	.preview-tab-shell.active {
		border-color: var(--color-border-subtle);
		background: var(--color-bg-content);
		color: var(--color-text-primary);
	}

	.preview-tab {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.25rem 0.375rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1rem;
		white-space: nowrap;
	}

	.preview-tab-kind {
		font-size: 0.625rem;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
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
		border-radius: 9999px;
		padding: 0.25rem 0.375rem;
		opacity: 0.65;
	}

	.preview-tab-close:hover {
		background: var(--color-bg-input);
		opacity: 1;
	}
</style>
