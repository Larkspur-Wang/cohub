<script lang="ts">
import { Minus, Plus, ZoomIn } from "lucide-svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import PreviewControl from "../PreviewControl.svelte";

const {
	zoom,
	min = 0.25,
	max = 4,
	step = 0.25,
	onChange,
	onReset,
	compact = false,
}: {
	zoom: number;
	min?: number;
	max?: number;
	step?: number;
	onChange: (next: number) => void;
	onReset: () => void;
	compact?: boolean;
} = $props();

const locale = $derived(getLocale());

function zoomOut() {
	onChange(Math.max(min, zoom - step));
}

function zoomIn() {
	onChange(Math.min(max, zoom + step));
}
</script>

<PreviewControl icon={ZoomIn} label={m.preview_zoom({}, { locale })} {compact} menuWidth={168}>
	{#snippet inline()}
		<div class="zoom" role="group" aria-label={m.preview_zoom({}, { locale })}>
			<button type="button" class="zoom-btn" title={m.inline_zoom_out({}, { locale })} aria-label={m.inline_zoom_out({}, { locale })} onclick={zoomOut}>
				<Minus class="h-4 w-4" />
			</button>
			<button type="button" class="zoom-value" title={m.preview_zoom_reset({}, { locale })} onclick={onReset}>
				{Math.round(zoom * 100)}%
			</button>
			<button type="button" class="zoom-btn" title={m.inline_zoom_in({}, { locale })} aria-label={m.inline_zoom_in({}, { locale })} onclick={zoomIn}>
				<Plus class="h-4 w-4" />
			</button>
		</div>
	{/snippet}
	{#snippet menu({ close }: { close: () => void })}
		<button type="button" class="menu-item" role="menuitem" onclick={() => { zoomIn(); close(); }}>
			<Plus class="h-3.5 w-3.5" />
			<span>{m.inline_zoom_in({}, { locale })}</span>
		</button>
		<button type="button" class="menu-item" role="menuitem" onclick={() => { zoomOut(); close(); }}>
			<Minus class="h-3.5 w-3.5" />
			<span>{m.inline_zoom_out({}, { locale })}</span>
		</button>
		<button type="button" class="menu-item" role="menuitem" onclick={() => { onReset(); close(); }}>
			<ZoomIn class="h-3.5 w-3.5" />
			<span>{m.preview_zoom_reset({}, { locale })}</span>
		</button>
	{/snippet}
</PreviewControl>

<style>
	.zoom {
		display: inline-flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-input);
		padding: 2px;
	}

	.zoom-btn {
		display: inline-flex;
		height: 1.5rem;
		width: 1.5rem;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.zoom-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.zoom-value {
		min-width: 2.5rem;
		height: 1.5rem;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.zoom-value:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
</style>
