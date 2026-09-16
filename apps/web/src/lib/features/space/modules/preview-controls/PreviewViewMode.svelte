<script lang="ts">
import { Check } from "lucide-svelte";
import PreviewControl from "../PreviewControl.svelte";
import type { PreviewIcon, PreviewOption } from "../preview-header";

let {
	value = $bindable(),
	options,
	triggerIcon,
	triggerLabel,
	compact = false,
}: {
	value: string;
	options: PreviewOption[];
	triggerIcon: PreviewIcon;
	triggerLabel: string;
	compact?: boolean;
} = $props();
</script>

<PreviewControl icon={triggerIcon} label={triggerLabel} {compact}>
	{#snippet inline()}
		<div class="view-mode" role="group" aria-label={triggerLabel}>
			{#each options as option (option.value)}
				<button
					type="button"
					class="view-mode-btn"
					class:active={option.value === value}
					title={option.title ?? option.label}
					aria-pressed={option.value === value}
					onclick={() => (value = option.value)}
				>
					<option.icon class="h-3.5 w-3.5" />
					<span>{option.label}</span>
				</button>
			{/each}
		</div>
	{/snippet}
	{#snippet menu({ close }: { close: () => void })}
		{#each options as option (option.value)}
			<button
				type="button"
				class="menu-item"
				role="menuitemradio"
				aria-checked={option.value === value}
				onclick={() => {
					value = option.value;
					close();
				}}
			>
				<option.icon class="h-3.5 w-3.5" />
				<span>{option.label}</span>
				{#if option.value === value}
					<Check class="ml-auto h-3.5 w-3.5" />
				{/if}
			</button>
		{/each}
	{/snippet}
</PreviewControl>

<style>
	.view-mode {
		display: inline-flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-input);
		padding: 2px;
	}

	.view-mode-btn {
		display: inline-flex;
		height: 1.5rem;
		align-items: center;
		gap: 4px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 0 7px;
		color: var(--text-tertiary);
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.view-mode-btn:hover {
		color: var(--text-secondary);
	}

	.view-mode-btn.active {
		background: var(--bg-elevated);
		color: var(--text-primary);
		box-shadow: 0 1px 2px color-mix(in srgb, var(--overlay-scrim-strong) 10%, transparent);
	}
</style>
