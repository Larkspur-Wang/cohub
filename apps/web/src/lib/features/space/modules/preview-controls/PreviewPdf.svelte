<script lang="ts">
import { FileText, MoveHorizontal, ZoomIn, ZoomOut } from "lucide-svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import PreviewControl from "../PreviewControl.svelte";
import PreviewGroup from "./PreviewGroup.svelte";
import PreviewIconButton from "./PreviewIconButton.svelte";

const {
	page,
	pageCount,
	fitWidth,
	onGoToPage,
	onZoomIn,
	onZoomOut,
	onFitWidth,
	compact = false,
}: {
	page: number;
	pageCount: number;
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

{#snippet ZoomButtons()}
	<PreviewIconButton icon={ZoomOut} label={m.inline_zoom_out({}, { locale })} onclick={onZoomOut} />
	<PreviewIconButton icon={ZoomIn} label={m.inline_zoom_in({}, { locale })} onclick={onZoomIn} />
	<span class="pdf-divider" aria-hidden="true"></span>
	<PreviewIconButton
		icon={MoveHorizontal}
		label={m.inline_fit_width({}, { locale })}
		active={fitWidth}
		onclick={onFitWidth}
	/>
{/snippet}

<PreviewControl icon={FileText} label={m.preview_pages({}, { locale })} {compact} menuWidth={200}>
	{#snippet inline()}
		<div class="pdf-inline">
			{@render PageInput()}
			<span class="pdf-total">/ {pageCount}</span>
			<PreviewGroup label={m.preview_zoom({}, { locale })}>
				{@render ZoomButtons()}
			</PreviewGroup>
		</div>
	{/snippet}
	{#snippet menu()}
		<div class="pdf-menu">
			<div class="pdf-menu-row">
				{@render PageInput()}
				<span class="pdf-total">/ {pageCount}</span>
			</div>
			<div class="pdf-menu-row">
				<PreviewGroup label={m.preview_zoom({}, { locale })}>
					{@render ZoomButtons()}
				</PreviewGroup>
			</div>
		</div>
	{/snippet}
</PreviewControl>

<style>
	.pdf-inline {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.pdf-input {
		width: 2.5rem;
		height: 1.75rem;
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

	.pdf-total {
		flex-shrink: 0;
		color: var(--text-tertiary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.pdf-divider {
		width: 1px;
		height: 1rem;
		margin-inline: 2px;
		background: var(--border-subtle);
	}

	.pdf-menu {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.pdf-menu-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>
