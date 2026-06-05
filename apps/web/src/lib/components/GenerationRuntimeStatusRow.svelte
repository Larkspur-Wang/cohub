<script lang="ts">
type Props = {
	model?: string | null;
	compact?: boolean;
};

const { model = null, compact = false }: Props = $props();
const label = $derived(
	model?.trim() ? `waiting ${model.trim()}` : "waiting model",
);
</script>

<div class={`inline-flex items-center gap-2 ${compact ? 'px-2 py-1' : 'px-2 py-2'} text-[13px] leading-none text-text-tertiary`}>
	<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand motion-safe:animate-pulse"></span>
	<span class="truncate tabular-nums">{label}</span>
</div>
