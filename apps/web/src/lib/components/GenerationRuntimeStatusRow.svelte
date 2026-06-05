<script lang="ts">
type Props = {
	label?: string | null;
	model?: string | null;
	compact?: boolean;
};

const {
	label: labelInput = null,
	model = null,
	compact = false,
}: Props = $props();
const label = $derived(
	labelInput?.trim() ||
		(model?.trim() ? `waiting ${model.trim()}` : "waiting model"),
);
</script>

<div class={`inline-flex items-center gap-1.5 ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'} text-[12px] leading-none text-text-tertiary`}>
	<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand/70 motion-safe:animate-pulse"></span>
	<span class="truncate tabular-nums">{label}</span>
</div>
