<script lang="ts">
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-svelte";
import { getLocale } from "$lib/i18n/locale.svelte";
import { m } from "$lib/paraglide/messages.js";
import PreviewControl from "../PreviewControl.svelte";
import PreviewGroup from "./PreviewGroup.svelte";
import PreviewIconButton from "./PreviewIconButton.svelte";

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
		<PreviewGroup label={m.preview_zoom({}, { locale })}>
			<PreviewIconButton icon={ZoomOut} label={m.inline_zoom_out({}, { locale })} onclick={zoomOut} />
			<PreviewIconButton icon={ZoomIn} label={m.inline_zoom_in({}, { locale })} onclick={zoomIn} />
		</PreviewGroup>
	{/snippet}
	{#snippet menu({ close }: { close: () => void })}
		<button type="button" class="menu-item" role="menuitem" onclick={() => { zoomIn(); close(); }}>
			<ZoomIn class="h-3.5 w-3.5" />
			<span>{m.inline_zoom_in({}, { locale })}</span>
		</button>
		<button type="button" class="menu-item" role="menuitem" onclick={() => { zoomOut(); close(); }}>
			<ZoomOut class="h-3.5 w-3.5" />
			<span>{m.inline_zoom_out({}, { locale })}</span>
		</button>
		<button type="button" class="menu-item" role="menuitem" onclick={() => { onReset(); close(); }}>
			<RotateCcw class="h-3.5 w-3.5" />
			<span>{m.preview_zoom_reset({}, { locale })}</span>
		</button>
	{/snippet}
</PreviewControl>
