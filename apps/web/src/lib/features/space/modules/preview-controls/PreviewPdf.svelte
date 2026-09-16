<script lang="ts">
import { FileText, Minus, MoveHorizontal, Plus } from "lucide-svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import PreviewControl from "../PreviewControl.svelte";

const {
	page,
	pageCount,
	scale,
	fitWidth,
	onGoToPage,
	onZoomIn,
	onZoomOut,
	onFitWidth,
	compact = false,
}: {
	page: number;
	pageCount: number;
	scale: number;
	fitWidth: boolean;
	onGoToPage: (page: number) => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
	onFitWidth: () => void;
	compact?: boolean;
} = $props();

const locale = $derived(getLocale());

let draft = $state("");
let focused = $state(false);
const value = $derived(focused ? draft : String(page ?? ""));

function commit() {
	const parsed = Number.parseInt(draft, 10);
	if (Number.isFinite(parsed)) onGoToPage(parsed);
	draft = String(page ?? 1);
}
</script>

{#snippet PageInput()}
	<input
		class="pdf-input"
		type="text"
		inputmode="numeric"
		aria-label={m.inline_page_number({}, { locale })}
		value={value}
		oninput={(event) => (draft = event.currentTarget.value)}
		onfocus={(event) => {
			focused = true;
			draft = String(page ?? 1);
			event.currentTarget.select();
		}}
		onblur={() => {
			focused = false;
			commit();
		}}
		onkeydown={(event) => {
			if (event.key === "Enter") event.currentTarget.blur();
		}}
	/>
{/snippet}

{#snippet Zoom()}
	<button type="button" class="pdf-btn" title={m.inline_zoom_out({}, { locale })} aria-label={m.inline_zoom_out({}, { locale })} onclick={onZoomOut}>
		<Minus class="h-3.5 w-3.5" />
	</button>
	<span class="pdf-scale">{Math.round(scale * 100)}%</span>
	<button type="button" class="pdf-btn" title={m.inline_zoom_in({}, { locale })} aria-label={m.inline_zoom_in({}, { locale })} onclick={onZoomIn}>
		<Plus class="h-3.5 w-3.5" />
	</button>
{/snippet}

<PreviewControl icon={FileText} label={m.preview_pages({}, { locale })} {compact} menuWidth={212}>
	{#snippet inline()}
		<div class="pdf" role="group" aria-label={m.preview_pages({}, { locale })}>
			{@render PageInput()}
			<span class="pdf-total">/ {pageCount}</span>
			<span class="pdf-divider"></span>
			{@render Zoom()}
		</div>
	{/snippet}
	{#snippet menu({ close }: { close: () => void })}
		<div class="pdf-menu">
			<div class="pdf-menu-row">
				{@render PageInput()}
				<span class="pdf-total">/ {pageCount}</span>
			</div>
			<div class="pdf-menu-row">
				{@render Zoom()}
				<button
					type="button"
					class="pdf-btn"
					class:active={fitWidth}
					title={m.inline_fit_width({}, { locale })}
					aria-label={m.inline_fit_width({}, { locale })}
					aria-pressed={fitWidth}
					onclick={() => {
						onFitWidth();
						close();
					}}
				>
					<MoveHorizontal class="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	{/snippet}
</PreviewControl>

<style>
	.pdf {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
	}

	.pdf-input {
		width: 2.5rem;
		height: 1.5rem;
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		background: var(--bg-input);
		color: var(--text-primary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.pdf-input:focus {
		border-color: color-mix(in srgb, var(--brand) 50%, transparent);
		outline: none;
	}

	.pdf-total,
	.pdf-scale {
		flex-shrink: 0;
		color: var(--text-tertiary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.pdf-scale {
		min-width: 2.5rem;
		text-align: center;
	}

	.pdf-divider {
		width: 1px;
		height: 1rem;
		margin-inline: 3px;
		background: var(--border-subtle);
	}

	.pdf-btn {
		display: inline-flex;
		height: 1.5rem;
		min-width: 1.5rem;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		padding: 0 4px;
		color: var(--text-tertiary);
		font-size: 11px;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.pdf-btn:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.pdf-btn.active {
		background: var(--bg-hover-strong);
		color: var(--text-secondary);
	}

	.pdf-menu {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.pdf-menu-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
</style>
